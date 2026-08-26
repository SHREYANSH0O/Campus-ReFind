import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { initialiseDatabase, isConfiguredAdminEmail, many, normaliseEmail, one, passwordHash, passwordMatches, run, withTransaction } from "./db.mjs";
import { presentItem } from "./item-privacy.mjs";
import { calculateMatch } from "./matching.mjs";
import { ensureStorageBucket, imagePublicUrl, saveImage } from "./storage.mjs";
import { projectDirectory } from "./runtime-paths.mjs";

const publicDirectory = join(projectDirectory, "public");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3333);
const isProduction = process.env.NODE_ENV === "production";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const campusLocations = ["Central Library", "Canteen", "Block A", "Block B", "Block C", "Block D", "Block E", "Parking", "Auditorium", "Sports Ground", "Vivekanand Hall", "Main Gate", "Other"];
const pickupInstructions = "Your claim has been approved. Please collect the item from the Student Affairs Office between 11:00 AM and 3:00 PM, and bring your college ID.";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const itemSelect = `
  SELECT
    i.id,
    i.report_type,
    i.title,
    i.category,
    i.color,
    i.brand,
    i.description,
    i.private_notes,
    i.location,
    i.reported_date::text AS reported_date,
    i.status,
    i.image_name,
    i.user_id,
    i.created_at,
    i.updated_at,
    u.name AS reporter_name,
    u.department AS reporter_department,
    (
      SELECT COUNT(*)::int
      FROM claims c
      WHERE c.item_id = i.id AND c.status = 'pending'
    ) AS pending_claims
  FROM items i
  JOIN users u ON u.id = i.user_id
`;

function json(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function error(response, exception) {
  json(response, exception.status || 500, { error: exception.message || "Something went wrong." });
}

function textValue(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function required(value, label, maximum = 500) {
  const clean = textValue(value, maximum);
  if (!clean) throw new HttpError(400, `${label} is required.`);
  return clean;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "This request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Send valid JSON data.");
  }
}

async function readMultipart(request) {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) throw new HttpError(413, "Images must be 5 MB or smaller.");
  try {
    return await new Request(`http://localhost${request.url}`, {
      method: request.method,
      headers: request.headers,
      body: Readable.toWeb(request),
      duplex: "half",
    }).formData();
  } catch {
    throw new HttpError(400, "Please submit a valid report form.");
  }
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter((part) => part.length));
}

async function syncConfiguredAdminRole(user, executor) {
  if (!user || user.role === "admin" || !isConfiguredAdminEmail(user.email)) return user;
  await run("UPDATE users SET role = 'admin' WHERE id = $1", [user.id], executor);
  return { ...user, role: "admin" };
}

async function currentUser(request) {
  const token = parseCookies(request).session;
  if (!token) return null;
  const user = await one(`
    SELECT u.id, u.name, u.email, u.department, u.role, u.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > NOW()
  `, [token]);
  if (!user) {
    await run("DELETE FROM sessions WHERE token = $1 OR expires_at < NOW()", [token]).catch(() => {});
    return null;
  }
  return syncConfiguredAdminRole(user);
}

function publicUser(user) {
  return user && { id: user.id, name: user.name, email: user.email, department: user.department, role: user.role, created_at: user.created_at };
}

async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  return user;
}

async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "Administrator access is required.");
  return user;
}

async function addNotification(userId, title, message, link = "", executor) {
  await run("INSERT INTO notifications (user_id, title, message, link) VALUES ($1, $2, $3, $4)", [userId, title, message, link], executor);
}

async function startSession(userId, executor) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await run("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, userId, expiresAt], executor);
  return token;
}

function cookieHeader(token, expired = false) {
  return [
    `session=${token || ""}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${expired ? 0 : Math.floor(SESSION_DURATION_MS / 1000)}`,
    isProduction ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

async function itemQuery(where = "", parameters = [], executor) {
  const items = await many(`
    ${itemSelect}
    ${where}
    ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'matched' THEN 1 WHEN 'claimed' THEN 2 ELSE 3 END, i.created_at DESC
  `, parameters, executor);
  return items.map(itemForClient);
}

function itemForClient(item) {
  return {
    ...item,
    pending_claims: Number(item.pending_claims || 0),
    image_url: imagePublicUrl(item.image_name),
    private_notes: undefined,
  };
}

async function getItem(id, executor) {
  const item = await one(`
    ${itemSelect}
    WHERE i.id = $1
  `, [id], executor);
  if (!item) throw new HttpError(404, "That report could not be found.");
  return item;
}

async function getMatches(item, limit = 6, executor) {
  const opposite = item.report_type === "lost" ? "found" : "lost";
  const oppositeItems = await itemQuery("WHERE i.report_type = $1 AND i.status IN ('open', 'matched', 'claimed') AND i.id != $2", [opposite, item.id], executor);
  return oppositeItems
    .map((candidate) => ({ ...candidate, ...calculateMatch(item, candidate) }))
    .filter((candidate) => candidate.score >= 30)
    .sort((a, b) => b.score - a.score || b.id - a.id)
    .slice(0, limit);
}

function ensureItemOwnerOrAdmin(item, user) {
  if (item.user_id !== user.id && user.role !== "admin") throw new HttpError(403, "Only the report owner or an administrator can do that.");
}

async function saveImageOrThrow(file) {
  try {
    return await saveImage(file);
  } catch (error) {
    if (String(error.message || "").includes("5 MB")) throw new HttpError(413, error.message);
    if (String(error.message || "").includes("JPG, PNG, or WEBP")) throw new HttpError(400, error.message);
    throw error;
  }
}

async function dashboardFor(user) {
  const reports = Number((await one("SELECT COUNT(*)::int AS total FROM items WHERE user_id = $1", [user.id])).total);
  const openReports = Number((await one("SELECT COUNT(*)::int AS total FROM items WHERE user_id = $1 AND status IN ('open', 'matched', 'claimed')", [user.id])).total);
  const activeClaims = Number((await one("SELECT COUNT(*)::int AS total FROM claims WHERE claimant_id = $1 AND status = 'pending'", [user.id])).total);
  const notifications = Number((await one("SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1 AND is_read = FALSE", [user.id])).total);
  const items = await itemQuery("WHERE i.user_id = $1", [user.id]);
  const matchLists = await Promise.all(items.map(async (item) => (await getMatches(item, 3)).map((match) => ({ report: item, match }))));
  const matches = matchLists.flat()
    .sort((a, b) => b.match.score - a.match.score).slice(0, 5);
  return { counts: { reports, openReports, activeClaims, notifications }, recent_reports: items.slice(0, 5), possible_matches: matches };
}

async function adminOverview() {
  const scalar = async (sql, parameters = []) => Number((await one(sql, parameters)).total);
  return {
    counts: {
      users: await scalar("SELECT COUNT(*)::int AS total FROM users"),
      lost: await scalar("SELECT COUNT(*)::int AS total FROM items WHERE report_type = 'lost'"),
      found: await scalar("SELECT COUNT(*)::int AS total FROM items WHERE report_type = 'found'"),
      returned: await scalar("SELECT COUNT(*)::int AS total FROM items WHERE status = 'returned'"),
      pendingClaims: await scalar("SELECT COUNT(*)::int AS total FROM claims WHERE status = 'pending'"),
    },
    category_data: await many("SELECT category AS label, COUNT(*)::int AS value FROM items GROUP BY category ORDER BY value DESC LIMIT 6"),
    location_data: await many("SELECT location AS label, COUNT(*)::int AS value FROM items GROUP BY location ORDER BY value DESC LIMIT 6"),
    recent_items: (await itemQuery("", [])).slice(0, 8),
  };
}

async function api(request, response, url) {
  const method = request.method;
  const path = url.pathname;

  if (method === "GET" && path === "/api/health") {
    const databaseReachable = (await one("SELECT 1 AS ok")).ok === 1;
    return json(response, 200, { status: "ok", database: databaseReachable ? "ok" : "error" });
  }
  if (method === "GET" && path === "/api/locations") return json(response, 200, { locations: campusLocations });
  if (method === "GET" && path === "/api/auth/me") return json(response, 200, { user: publicUser(await currentUser(request)) });

  if (method === "POST" && path === "/api/auth/register") {
    const body = await readJson(request);
    const name = required(body.name, "Name", 100);
    const email = normaliseEmail(required(body.email, "Email", 160));
    const department = textValue(body.department, 100);
    const password = required(body.password, "Password", 200);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (password.length < 8) throw new HttpError(400, "Use a password with at least 8 characters.");
    const { token, user } = await withTransaction(async (client) => {
      const existing = await one("SELECT id FROM users WHERE lower(email) = lower($1)", [email], client);
      if (existing) throw new HttpError(409, "An account with that email already exists.");
      const createdUser = await one(`
        INSERT INTO users (name, email, password_hash, department, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, email, department, role, created_at
      `, [name, email, passwordHash(password), department, isConfiguredAdminEmail(email) ? "admin" : "student"], client);
      await addNotification(createdUser.id, "Welcome to Campus ReFind", "Your account is ready. You can now report, match, and claim items.", "dashboard", client);
      return { user: createdUser, token: await startSession(createdUser.id, client) };
    });
    return json(response, 201, { user: publicUser(user) }, { "set-cookie": cookieHeader(token) });
  }

  if (method === "POST" && path === "/api/auth/login") {
    const body = await readJson(request);
    const email = normaliseEmail(required(body.email, "Email", 160));
    const password = required(body.password, "Password", 200);
    const user = await one("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    if (!user || !passwordMatches(password, user.password_hash)) throw new HttpError(401, "Incorrect email or password.");
    const syncedUser = await syncConfiguredAdminRole(user);
    const token = await startSession(user.id);
    return json(response, 200, { user: publicUser(syncedUser) }, { "set-cookie": cookieHeader(token) });
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const token = parseCookies(request).session;
    if (token) await run("DELETE FROM sessions WHERE token = $1", [token]);
    return json(response, 200, { ok: true }, { "set-cookie": cookieHeader("", true) });
  }

  if (method === "GET" && path === "/api/dashboard") return json(response, 200, await dashboardFor(await requireUser(request)));

  if (method === "GET" && path === "/api/items") {
    const values = [];
    const clauses = [];
    const type = textValue(url.searchParams.get("type"), 12);
    const category = textValue(url.searchParams.get("category"), 80);
    const location = textValue(url.searchParams.get("location"), 80);
    const status = textValue(url.searchParams.get("status"), 20);
    const search = textValue(url.searchParams.get("search"), 100);
    if (["lost", "found"].includes(type)) { values.push(type); clauses.push(`i.report_type = $${values.length}`); }
    if (category) { values.push(category); clauses.push(`i.category = $${values.length}`); }
    if (location) { values.push(location); clauses.push(`i.location = $${values.length}`); }
    if (["open", "matched", "claimed", "returned", "archived"].includes(status)) { values.push(status); clauses.push(`i.status = $${values.length}`); }
    if (search) {
      values.push(`%${search}%`);
      const placeholder = `$${values.length}`;
      clauses.push(`(i.title ILIKE ${placeholder} OR i.description ILIKE ${placeholder} OR i.brand ILIKE ${placeholder})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return json(response, 200, { items: await itemQuery(where, values) });
  }

  const itemIdMatch = path.match(/^\/api\/items\/(\d+)$/);
  if (method === "GET" && itemIdMatch) {
    const item = await getItem(Number(itemIdMatch[1]));
    const user = await currentUser(request);
    return json(response, 200, { item: presentItem(itemForClient(item), user) });
  }

  if (method === "POST" && path === "/api/items") {
    const user = await requireUser(request);
    const form = await readMultipart(request);
    const reportType = required(form.get("report_type"), "Report type", 12);
    if (!["lost", "found"].includes(reportType)) throw new HttpError(400, "Choose whether this is a lost or found report.");
    const reportedDate = required(form.get("reported_date"), "Date", 12);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportedDate)) throw new HttpError(400, "Enter a valid date.");
    const imageName = await saveImageOrThrow(form.get("image"));
    const result = await withTransaction(async (client) => {
      const item = await one(`
        INSERT INTO items
          (report_type, title, category, color, brand, description, private_notes, location, reported_date, image_name, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        reportType,
        required(form.get("title"), "Item name", 120),
        required(form.get("category"), "Category", 60),
        textValue(form.get("color"), 50),
        textValue(form.get("brand"), 80),
        required(form.get("description"), "Description", 1500),
        textValue(form.get("private_notes"), 500),
        required(form.get("location"), "Location", 80),
        reportedDate,
        imageName,
        user.id,
      ], client);
      let createdItem = await getItem(item.id, client);
      const matches = await getMatches(createdItem, 6, client);
      if (matches.length) {
        await run("UPDATE items SET status = 'matched', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [createdItem.id], client);
        createdItem = await getItem(createdItem.id, client);
        await addNotification(user.id, "Possible match found", `${matches.length} possible ${matches.length === 1 ? "report matches" : "reports match"} your new ${reportType} report.`, `item:${createdItem.id}`, client);
      }
      await addNotification(user.id, "Report submitted", `Your ${reportType} report for “${createdItem.title}” is now live.`, `item:${createdItem.id}`, client);
      return { item: itemForClient(createdItem), matches };
    });
    return json(response, 201, result);
  }

  const matchesPath = path.match(/^\/api\/items\/(\d+)\/matches$/);
  if (method === "GET" && matchesPath) {
    const user = await requireUser(request);
    const item = await getItem(Number(matchesPath[1]));
    ensureItemOwnerOrAdmin(item, user);
    return json(response, 200, { matches: await getMatches(item) });
  }

  const claimPath = path.match(/^\/api\/items\/(\d+)\/claim$/);
  if (method === "POST" && claimPath) {
    const user = await requireUser(request);
    const item = await getItem(Number(claimPath[1]));
    const body = await readJson(request);
    if (item.report_type !== "found") throw new HttpError(400, "Only found-item reports can be claimed.");
    if (item.user_id === user.id) throw new HttpError(400, "You cannot claim your own report.");
    if (!["open", "matched", "claimed"].includes(item.status)) throw new HttpError(400, "This item is no longer available to claim.");
    const claimId = await withTransaction(async (client) => {
      const existing = await one("SELECT id FROM claims WHERE item_id = $1 AND claimant_id = $2", [item.id, user.id], client);
      if (existing) throw new HttpError(409, "You have already submitted a claim for this item.");
      const claim = await one(`
        INSERT INTO claims
          (item_id, claimant_id, ownership_details, exact_brand, unique_mark, lost_location)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        item.id,
        user.id,
        required(body.ownership_details, "What was inside or with the item", 600),
        textValue(body.exact_brand, 100),
        textValue(body.unique_mark, 300),
        textValue(body.lost_location, 100),
      ], client);
      await run("UPDATE items SET status = 'claimed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [item.id], client);
      await addNotification(item.user_id, "New ownership claim", `${user.name} submitted a verification claim for “${item.title}”.`, "admin", client);
      await addNotification(user.id, "Claim submitted", `Your claim for “${item.title}” is pending administrator review.`, "claims", client);
      return claim.id;
    });
    return json(response, 201, { claim_id: claimId, message: "Your ownership claim has been submitted for review." });
  }

  if (method === "GET" && path === "/api/my/claims") {
    const user = await requireUser(request);
    const claims = (await many(`
      SELECT c.*, i.title AS item_title, i.category, i.location, i.image_name, i.status AS item_status
      FROM claims c
      JOIN items i ON i.id = c.item_id
      WHERE c.claimant_id = $1
      ORDER BY c.created_at DESC
    `, [user.id])).map((claim) => ({ ...claim, image_url: imagePublicUrl(claim.image_name) }));
    return json(response, 200, { claims });
  }

  if (method === "GET" && path === "/api/notifications") {
    const user = await requireUser(request);
    return json(response, 200, { notifications: await many("SELECT * FROM notifications WHERE user_id = $1 ORDER BY is_read ASC, created_at DESC LIMIT 30", [user.id]) });
  }

  const readPath = path.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (method === "POST" && readPath) {
    const user = await requireUser(request);
    await run("UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2", [Number(readPath[1]), user.id]);
    return json(response, 200, { ok: true });
  }

  if (method === "GET" && path === "/api/admin/overview") {
    await requireAdmin(request);
    return json(response, 200, await adminOverview());
  }

  if (method === "GET" && path === "/api/admin/claims") {
    await requireAdmin(request);
    const claims = (await many(`
      SELECT
        c.*,
        i.title AS item_title,
        i.category,
        i.location,
        i.report_type,
        i.image_name,
        i.status AS item_status,
        claimant.name AS claimant_name,
        claimant.email AS claimant_email,
        reporter.name AS reporter_name
      FROM claims c
      JOIN items i ON i.id = c.item_id
      JOIN users claimant ON claimant.id = c.claimant_id
      JOIN users reporter ON reporter.id = i.user_id
      ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC
    `)).map((claim) => ({ ...claim, image_url: imagePublicUrl(claim.image_name) }));
    return json(response, 200, { claims });
  }

  if (method === "GET" && path === "/api/admin/users") {
    await requireAdmin(request);
    const users = (await many(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.department,
        u.role,
        u.created_at,
        (SELECT COUNT(*)::int FROM items i WHERE i.user_id = u.id) AS reports,
        (SELECT COUNT(*)::int FROM claims c WHERE c.claimant_id = u.id) AS claims
      FROM users u
      ORDER BY u.created_at DESC
    `)).map((user) => ({ ...user, reports: Number(user.reports), claims: Number(user.claims) }));
    return json(response, 200, { users });
  }

  const adminClaimPath = path.match(/^\/api\/admin\/claims\/(\d+)$/);
  if (method === "PATCH" && adminClaimPath) {
    const admin = await requireAdmin(request);
    const body = await readJson(request);
    const status = required(body.status, "Decision", 20);
    if (!["approved", "rejected"].includes(status)) throw new HttpError(400, "Choose approve or reject.");
    const reviewNote = textValue(body.review_note, 800);
    await withTransaction(async (client) => {
      const claim = await one(`
        SELECT c.*, i.title AS item_title, i.user_id AS reporter_id
        FROM claims c
        JOIN items i ON i.id = c.item_id
        WHERE c.id = $1
      `, [Number(adminClaimPath[1])], client);
      if (!claim) throw new HttpError(404, "Claim not found.");
      if (claim.status !== "pending") throw new HttpError(409, "This claim has already been reviewed.");
      await run("UPDATE claims SET status = $1, review_note = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3", [status, reviewNote, claim.id], client);
      if (status === "approved") {
        await run("UPDATE items SET status = 'claimed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [claim.item_id], client);
        await addNotification(claim.claimant_id, "Claim approved — ready for pickup", `Your claim for “${claim.item_title}” was approved. ${pickupInstructions}${reviewNote ? ` Note: ${reviewNote}` : ""}`, "claims", client);
        await addNotification(claim.reporter_id, "Claim approved", `A verified claimant will collect “${claim.item_title}” through Student Affairs.`, "admin", client);
      } else {
        await addNotification(claim.claimant_id, "Claim not approved", `Your claim for “${claim.item_title}” was not approved.${reviewNote ? ` Note: ${reviewNote}` : ""}`, "claims", client);
        await addNotification(claim.reporter_id, "Claim not approved", `A claim for your report “${claim.item_title}” was not approved.`, "admin", client);
      }
      await addNotification(admin.id, "Claim updated", `You ${status} a claim for “${claim.item_title}”.`, "admin", client);
    });
    return json(response, 200, { ok: true });
  }

  const returnPath = path.match(/^\/api\/admin\/claims\/(\d+)\/return$/);
  if (method === "POST" && returnPath) {
    const admin = await requireAdmin(request);
    await withTransaction(async (client) => {
      const claim = await one(`
        SELECT c.*, i.title AS item_title, i.user_id AS reporter_id, i.status AS item_status
        FROM claims c
        JOIN items i ON i.id = c.item_id
        WHERE c.id = $1
      `, [Number(returnPath[1])], client);
      if (!claim) throw new HttpError(404, "Claim not found.");
      if (claim.status !== "approved") throw new HttpError(400, "Only approved claims can be marked returned.");
      if (claim.item_status === "returned") throw new HttpError(409, "This item has already been marked returned.");
      await run("UPDATE items SET status = 'returned', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [claim.item_id], client);
      await addNotification(claim.claimant_id, "Item collected", `“${claim.item_title}” has been marked as returned by Student Affairs.`, "claims", client);
      await addNotification(claim.reporter_id, "Item returned", `“${claim.item_title}” has been collected by its verified owner through Student Affairs.`, "admin", client);
      await addNotification(admin.id, "Return completed", `You marked “${claim.item_title}” as returned.`, "admin", client);
    });
    return json(response, 200, { ok: true });
  }

  const adminItemPath = path.match(/^\/api\/admin\/items\/(\d+)$/);
  if (method === "PATCH" && adminItemPath) {
    await requireAdmin(request);
    const body = await readJson(request);
    const status = required(body.status, "Status", 20);
    if (!["open", "matched", "claimed", "returned", "archived"].includes(status)) throw new HttpError(400, "Invalid item status.");
    const item = await getItem(Number(adminItemPath[1]));
    await run("UPDATE items SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [status, item.id]);
    await addNotification(item.user_id, "Report status updated", `Your report “${item.title}” is now marked ${status}.`, `item:${item.id}`);
    return json(response, 200, { ok: true });
  }

  throw new HttpError(404, "That API route was not found.");
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const safe = normalize(relative).replace(/^(\.\.(?:[\\/]|$))+/, "");
  const filePath = join(publicDirectory, safe);
  if (!filePath.startsWith(publicDirectory)) throw new HttpError(403, "Forbidden.");
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream", "x-content-type-options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    if (extname(filePath)) throw new HttpError(404, "Page not found.");
    const app = await readFile(join(publicDirectory, "index.html"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : app);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await api(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
    return await serveStatic(request, response, url.pathname);
  } catch (exception) {
    error(response, exception);
  }
});

async function boot() {
  await initialiseDatabase();
  try {
    await ensureStorageBucket();
  } catch (error) {
    console.warn(`Storage setup warning: ${error.message || error}`);
  }
  server.listen(port, host, () => {
    console.log(`Campus ReFind is running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  });
}

boot().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
