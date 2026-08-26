const view = document.querySelector("#view");
const authDialog = document.querySelector("#authDialog");
const itemDialog = document.querySelector("#itemDialog");
const claimDialog = document.querySelector("#claimDialog");
const noticesDialog = document.querySelector("#notificationsDialog");
const profileDialog = document.querySelector("#profileDialog");
const locations = ["Central Library", "Canteen", "Block A", "Block B", "Block C", "Block D", "Block E", "Parking", "Auditorium", "Sports Ground", "Vivekanand Hall", "Main Gate", "Other"];
const categories = ["Accessories", "Electronics", "Personal items", "Books & stationery", "Keys & ID", "Clothing", "Bags", "Other"];
const state = { user: null, route: "dashboard", notices: [] };

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]);
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "R";
const dateLabel = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date) ? value : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
};
const timeLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date) ? "Recently" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
};
const plural = (number, word) => `${number} ${word}${number === 1 ? "" : "s"}`;
const typeLabel = (type) => type === "lost" ? "Lost" : "Found";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast${type === "error" ? " error" : ""}`;
  element.textContent = message;
  document.querySelector("#toastRegion").append(element);
  setTimeout(() => element.remove(), 4300);
}

function dialogOpen(dialog) {
  if (!dialog.open) dialog.showModal();
}

function setRoute(route) {
  const routes = ["dashboard", "browse", "report", "claims", "admin"];
  state.route = routes.includes(route) ? route : "dashboard";
  if (location.hash !== `#${state.route}`) history.replaceState(null, "", `#${state.route}`);
  document.querySelector("#mobileNav").classList.remove("open");
  render();
}

function updateChrome() {
  document.querySelectorAll(".signed-in-only").forEach((element) => element.classList.toggle("hidden", !state.user));
  document.querySelectorAll(".auth-only").forEach((element) => element.classList.toggle("hidden", Boolean(state.user)));
  document.querySelectorAll(".admin-only").forEach((element) => element.classList.toggle("hidden", state.user?.role !== "admin"));
  document.querySelectorAll("[data-route]").forEach((element) => element.classList.toggle("active", element.dataset.route === state.route));
  const profile = document.querySelector("#profileButton");
  if (state.user) profile.textContent = initials(state.user.name);
  document.querySelector("#notificationBadge").textContent = state.notices.filter((notice) => !notice.is_read).length ? "•" : "";
}

function emptyState(title, description, action = "") {
  return `<div class="empty-state"><div><b>${escapeHtml(title)}</b><p>${escapeHtml(description)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div></div>`;
}

function itemImage(item, className = "item-image") {
  return `<div class="${className}">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" />` : "⌕"}</div>`;
}

function itemCard(item) {
  return `<article class="item-card">
    <div class="item-image">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" />` : "⌕"}<span class="type-badge ${item.report_type}">${typeLabel(item.report_type)}</span></div>
    <div class="item-body"><span class="status-badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description)}</p><div class="item-meta"><span>⌖ ${escapeHtml(item.location)}</span><span>◷ ${dateLabel(item.reported_date)}</span></div>
      <div class="item-card-footer"><span class="small-link">${escapeHtml(item.category)}</span><button class="small-link" data-action="view-item" data-id="${item.id}">View details →</button></div>
    </div></article>`;
}

function statCard(label, value, helper, accent = false) {
  return `<article class="stat-card${accent ? " accent" : ""}"><p>${escapeHtml(label)}</p><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(helper)}</span></article>`;
}

async function renderLanding() {
  const reports = await api("/api/items?status=open").catch(() => ({ items: [] }));
  view.innerHTML = `<section class="hero">
    <div class="hero-copy"><p class="overline">A more thoughtful campus lost & found</p><h1>Things get lost.<br /><em>People get them back.</em></h1>
      <p class="page-intro">Campus ReFind makes it simple to report an item, discover genuine matches, and verify ownership through a safe, accountable handover.</p>
      <div class="hero-actions"><button class="button" data-action="sign-in">Report an item <span>→</span></button><button class="button button-secondary" data-route="browse">Browse found items</button></div>
    </div>
    <div class="hero-visual" aria-hidden="true"><div class="map-card"><span class="map-label library">Central library</span><span class="map-label block">Block A</span><span class="map-label canteen">Canteen</span><span class="map-pin one"><span>⌕</span></span><span class="map-pin two"><span>✓</span></span><span class="map-pin three"><span>!</span></span></div><div class="match-float"><p>POSSIBLE MATCH</p><strong>Black leather wallet</strong><span>87% detail match · Library</span></div></div>
  </section>
  <section class="panel"><div class="section-heading"><div><p class="overline">Community reports</p><h2>Recently reported items</h2></div><button class="small-link" data-route="browse">See all reports →</button></div>
  <div class="report-list">${reports.items.slice(0, 4).map(reportRow).join("") || emptyState("No reports yet", "Be the first to help reconnect an item.")}</div></section>`;
}

function reportRow(item) {
  return `<article class="report-row"><div class="report-thumb">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="" />` : "⌕"}</div><div><h3>${escapeHtml(item.title)}</h3><p>${typeLabel(item.report_type)} · ${escapeHtml(item.location)} · ${dateLabel(item.reported_date)}</p></div><button data-action="view-item" data-id="${item.id}">View</button></article>`;
}

async function renderDashboard() {
  if (!state.user) return renderLanding();
  const data = await api("/api/dashboard");
  view.innerHTML = `<section class="page-heading"><div><p class="overline">Your workspace</p><h1>Good to see you, <em>${escapeHtml(state.user.name.split(" ")[0])}.</em></h1><p class="page-intro">Keep track of reports, claims, and the leads most likely to reconnect an item.</p></div><button class="button" data-route="report">+ Report an item</button></section>
  <section class="stat-grid">${statCard("My reports", data.counts.reports, `${data.counts.openReports} active`)}${statCard("Possible matches", data.possible_matches.length, "Across your active reports", true)}${statCard("Pending claims", data.counts.activeClaims, "Awaiting verification")}${statCard("Unread alerts", data.counts.notifications, "Updates needing attention")}</section>
  <section class="dashboard-grid"><div><div class="panel"><div class="section-heading"><div><p class="overline">Your reports</p><h2>Recent activity</h2></div><button class="small-link" data-route="browse">Browse all →</button></div><div class="report-list">${data.recent_reports.length ? data.recent_reports.map(reportRow).join("") : emptyState("Nothing reported yet", "Start a report while its details are still fresh.", '<button class="button button-small" data-route="report">Report an item</button>')}</div></div></div>
  <aside><div class="panel"><div class="section-heading"><div><p class="overline">Matching engine</p><h2>Best leads</h2></div></div><div class="match-list">${data.possible_matches.length ? data.possible_matches.map(({ report, match }) => `<div class="match-row"><div class="score-ring">${match.score}%</div><div><h3>${escapeHtml(match.title)}</h3><p>For your ${escapeHtml(report.title)} · ${escapeHtml(match.reasons.join(", "))}</p></div><button class="small-link" data-action="view-item" data-id="${match.id}">View</button></div>`).join("") : emptyState("No matches yet", "New reports are checked automatically.")}</div></div>
  <div class="panel"><p class="overline">Need help?</p><h3>Every handover is verified.</h3><p style="margin:0;color:var(--muted);font-size:11px;line-height:1.7">Claimants answer ownership questions, and Student Affairs reviews the claim before a return is confirmed.</p></div></aside></section>`;
}

function selectOptions(values, selected, placeholder = "All") {
  return `<option value="">${escapeHtml(placeholder)}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
}

async function renderBrowse() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const current = { search: params.get("search") || "", type: params.get("type") || "", category: params.get("category") || "", location: params.get("location") || "" };
  const data = await api(`/api/items?${params.toString()}`);
  view.innerHTML = `<section class="page-heading"><div><p class="overline">Find a lead</p><h1>Search community <em>reports.</em></h1><p class="page-intro">Browse lost and found records by item, category, or campus location. Details stay protected until the verification step.</p></div>${state.user ? '<button class="button" data-route="report">+ Report an item</button>' : '<button class="button" data-action="sign-in">Sign in to report</button>'}</section>
  <form id="browseFilters" class="filters"><input name="search" value="${escapeHtml(current.search)}" placeholder="Search an item or brand" /><select name="type">${selectOptions(["lost", "found"], current.type, "Lost & found")}</select><select name="category">${selectOptions(categories, current.category, "All categories")}</select><select name="location">${selectOptions(locations, current.location, "All locations")}</select><button class="button button-small" type="submit">Search</button></form>
  <section class="cards">${data.items.length ? data.items.map(itemCard).join("") : `<div style="grid-column:1/-1">${emptyState("No reports match those filters", "Try a broader search or report the item yourself.")}</div>`}</section>`;
  document.querySelector("#browseFilters").addEventListener("submit", (event) => {
    event.preventDefault();
    const next = new URLSearchParams(new FormData(event.currentTarget));
    [...next.entries()].forEach(([key, value]) => { if (!value) next.delete(key); });
    history.replaceState(null, "", `#browse?${next.toString()}`);
    renderBrowse();
  });
}

function reportForm() {
  const today = new Date().toISOString().slice(0, 10);
  return `<section class="page-heading"><div><p class="overline">Create a report</p><h1>Let’s make it <em>findable.</em></h1><p class="page-intro">Share the useful details without revealing any private proof of ownership. The more accurate this report is, the better its matches will be.</p></div></section>
  <section class="report-layout"><form id="reportForm" class="report-form" enctype="multipart/form-data"><div class="form-section"><h3>What are you reporting?</h3><p>Select the type that best describes your situation.</p><div class="type-select"><label class="type-option"><input type="radio" name="report_type" value="lost" checked />I lost an item</label><label class="type-option"><input type="radio" name="report_type" value="found" />I found an item</label></div></div>
  <div class="form-section"><h3>Item details</h3><p>These public details help the matching engine find the right reports.</p><div class="form-grid"><div class="form-field full"><label>Item name</label><input name="title" maxlength="120" placeholder="e.g. Black leather wallet" required /></div><div class="form-field"><label>Category</label><select name="category" required>${selectOptions(categories, "", "Select a category")}</select></div><div class="form-field"><label>Color</label><input name="color" maxlength="50" placeholder="e.g. Black" /></div><div class="form-field"><label>Brand / model</label><input name="brand" maxlength="80" placeholder="e.g. Wildhorn" /></div><div class="form-field"><label>Date lost / found</label><input name="reported_date" type="date" value="${today}" required /></div><div class="form-field"><label>Campus location</label><select name="location" required>${selectOptions(locations, "", "Select a location")}</select></div><div class="form-field full"><label>Public description</label><textarea name="description" maxlength="1500" placeholder="Describe the item, where it was last seen, and any non-sensitive details." required></textarea></div></div></div>
  <div class="form-section"><h3>Photo & verification detail</h3><p>A photo makes a report easier to recognize. Private details are only visible to an administrator during ownership review.</p><div class="form-grid"><div class="form-field"><label>Item photo (optional)</label><label class="upload-zone" id="uploadZone"><input id="imageInput" name="image" type="file" accept="image/jpeg,image/png,image/webp" /><div class="upload-placeholder"><strong>Upload a clear photo</strong><span>JPG, PNG, or WEBP · up to 5 MB</span></div><img class="upload-preview" alt="Selected image preview" /></label></div><div class="form-field"><label>Private identifying detail (optional)</label><textarea name="private_notes" maxlength="500" placeholder="e.g. serial number, inside engraving, contents. Never shown publicly."></textarea></div></div></div>
  <div style="display:flex;justify-content:flex-end;margin-top:25px"><button class="button" type="submit">Publish report <span>→</span></button></div><p class="form-feedback" id="reportFeedback"></p></form>
  <aside class="report-aside"><p class="overline">How it works</p><h3>Safe from report to return.</h3><p>Campus ReFind automatically compares category, location, color, brand, and date to find possible matches.</p><div class="workflow"><div><i>1</i> Report the item</div><div><i>2</i> Review possible matches</div><div><i>3</i> Verify ownership</div><div><i>4</i> Complete the return</div></div></aside></section>`;
}

async function renderReport() {
  if (!state.user) { dialogOpen(authDialog); return renderLanding(); }
  view.innerHTML = reportForm();
  const imageInput = document.querySelector("#imageInput");
  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("Please select an image smaller than 5 MB.", "error"); imageInput.value = ""; return; }
    const zone = document.querySelector("#uploadZone");
    zone.querySelector(".upload-preview").src = URL.createObjectURL(file);
    zone.classList.add("has-preview");
  });
  document.querySelector("#reportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const feedback = document.querySelector("#reportFeedback");
    button.disabled = true; feedback.textContent = "Publishing your report…";
    try {
      const response = await api("/api/items", { method: "POST", body: new FormData(event.currentTarget) });
      toast(response.matches.length ? `Report published — ${plural(response.matches.length, "possible match")} found.` : "Your report is live and ready to match.");
      setRoute("dashboard");
      setTimeout(() => showItem(response.item.id), 150);
    } catch (exception) { feedback.textContent = exception.message; }
    finally { button.disabled = false; }
  });
}

async function renderClaims() {
  if (!state.user) { dialogOpen(authDialog); return renderLanding(); }
  const data = await api("/api/my/claims");
  const claimRows = data.claims.map((claim) => {
    const pickupPending = claim.status === "approved" && claim.item_status !== "returned";
    const label = claim.item_status === "returned" ? "returned" : pickupPending ? "approved · pickup" : claim.status;
    const className = claim.item_status === "returned" ? "returned" : claim.status;
    const note = claim.review_note || (pickupPending ? "Collect from Student Affairs, 11 AM–3 PM, with your college ID." : "—");
    return `<tr><td><strong>${escapeHtml(claim.item_title)}</strong><span>${escapeHtml(claim.location)}</span></td><td>${timeLabel(claim.created_at)}</td><td><span class="status-badge ${escapeHtml(className)}">${escapeHtml(label)}</span></td><td>${escapeHtml(note)}</td><td><button class="small-link" data-action="view-item" data-id="${claim.item_id}">View</button></td></tr>`;
  }).join("");
  view.innerHTML = `<section class="page-heading"><div><p class="overline">Ownership verification</p><h1>Your <em>claims.</em></h1><p class="page-intro">Once approved, collect your item from Student Affairs with your college ID. Staff marks it returned only after collection.</p></div><button class="button button-secondary" data-route="browse">Browse found items</button></section><section class="panel"><div class="section-heading"><div><p class="overline">Claim history</p><h2>Submitted claims</h2></div></div>${data.claims.length ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Submitted</th><th>Status</th><th>Administrator note</th><th></th></tr></thead><tbody>${claimRows}</tbody></table></div>` : emptyState("No claims submitted", "When you recognize a found item, submit a claim with private proof of ownership.", '<button class="button button-small" data-route="browse">Browse found items</button>')}</section>`;
}

function bars(data) {
  const maximum = Math.max(...data.map((row) => Number(row.value)), 1);
  return data.length ? `<div class="bar-chart">${data.map((row) => `<div class="bar-row"><span>${escapeHtml(row.label)}</span><div class="bar"><b style="width:${Math.round((row.value / maximum) * 100)}%"></b></div><strong>${row.value}</strong></div>`).join("")}</div>` : emptyState("Not enough data", "Reports will appear here as they are created.");
}

async function renderAdmin() {
  if (!state.user || state.user.role !== "admin") { toast("Administrator access is required.", "error"); return setRoute("dashboard"); }
  const [overview, claims, users] = await Promise.all([api("/api/admin/overview"), api("/api/admin/claims"), api("/api/admin/users")]);
  const claimRows = claims.claims.map((claim) => {
    const pickupPending = claim.status === "approved" && claim.item_status !== "returned";
    const label = claim.item_status === "returned" ? "returned" : pickupPending ? "approved · pickup" : claim.status;
    const className = claim.item_status === "returned" ? "returned" : claim.status;
    const actions = claim.status === "pending"
      ? `<div class="table-actions"><button data-action="review-claim" data-id="${claim.id}" data-decision="approved">Approve</button><button class="reject" data-action="review-claim" data-id="${claim.id}" data-decision="rejected">Reject</button></div>`
      : pickupPending ? `<div class="table-actions"><button data-action="mark-returned" data-id="${claim.id}">Mark returned</button></div>` : "—";
    return `<tr><td><strong>${escapeHtml(claim.item_title)}</strong><span>${escapeHtml(claim.claimant_name)} · ${escapeHtml(claim.location)}</span></td><td>${escapeHtml(claim.ownership_details.slice(0, 70))}${claim.ownership_details.length > 70 ? "…" : ""}</td><td><span class="status-badge ${escapeHtml(className)}">${escapeHtml(label)}</span></td><td>${actions}</td></tr>`;
  }).join("");
  view.innerHTML = `<section class="page-heading"><div><p class="overline">Student Affairs control room</p><h1>Campus <em>operations.</em></h1><p class="page-intro">Review claims, manage the return workflow, and monitor where the campus community needs support.</p></div></section>
  <section class="stat-grid">${statCard("Registered users", overview.counts.users, "Community members")}${statCard("Lost reports", overview.counts.lost, "All-time reports")}${statCard("Found reports", overview.counts.found, "All-time reports", true)}${statCard("Returned items", overview.counts.returned, `${overview.counts.pendingClaims} claims waiting`)}</section>
  <section class="admin-grid"><div class="panel"><div class="section-heading"><div><p class="overline">Verification queue</p><h2>Ownership claims</h2></div><span class="status-badge claimed">${overview.counts.pendingClaims} pending</span></div><p style="margin:0 0 16px;color:var(--muted);font-size:11px;line-height:1.6">Approved claimants collect items from Student Affairs between 11 AM and 3 PM with their college ID. Mark an item returned only after collection.</p>${claims.claims.length ? `<div class="table-wrap"><table><thead><tr><th>Claimant & item</th><th>Proof summary</th><th>Status</th><th>Action</th></tr></thead><tbody>${claimRows}</tbody></table></div>` : emptyState("No claims to review", "The verification queue is currently clear.")}</div>
  <aside class="charts"><div class="panel"><div class="section-heading"><div><p class="overline">Report insight</p><h2>By category</h2></div></div>${bars(overview.category_data)}</div><div class="panel"><div class="section-heading"><div><p class="overline">Campus hotspots</p><h2>By location</h2></div></div>${bars(overview.location_data)}</div></aside></section>
  <section class="panel" style="margin-top:20px"><div class="section-heading"><div><p class="overline">Accounts</p><h2>Community members</h2></div><span style="font-size:11px;color:var(--muted)">${users.users.length} total</span></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>Role</th><th>Reports</th><th>Claims</th></tr></thead><tbody>${users.users.map((user) => `<tr><td><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.email)}</span></td><td>${escapeHtml(user.department || "—")}</td><td><span class="status-badge ${user.role === "admin" ? "matched" : ""}">${escapeHtml(user.role)}</span></td><td>${user.reports}</td><td>${user.claims}</td></tr>`).join("")}</tbody></table></div></section>`;
}

async function render() {
  updateChrome();
  view.setAttribute("aria-busy", "true");
  try {
    if (state.route === "browse") await renderBrowse();
    else if (state.route === "report") await renderReport();
    else if (state.route === "claims") await renderClaims();
    else if (state.route === "admin") await renderAdmin();
    else await renderDashboard();
  } catch (exception) {
    view.innerHTML = emptyState("We could not load this page", exception.message, '<button class="button button-small" data-route="dashboard">Try again</button>');
  } finally { view.removeAttribute("aria-busy"); updateChrome(); }
}

async function showItem(id) {
  try {
    const { item } = await api(`/api/items/${id}`);
    let matches = [];
    if (item.is_owner) matches = (await api(`/api/items/${id}/matches`)).matches;
    itemDialog.innerHTML = `<button class="close-dialog" data-close="itemDialog" aria-label="Close">×</button><div class="detail-grid">${itemImage(item, "detail-image")}<div class="detail-content"><span class="type-badge ${item.report_type}">${typeLabel(item.report_type)} report</span><h2 style="margin-top:10px">${escapeHtml(item.title)}</h2><div class="item-meta"><span>⌖ ${escapeHtml(item.location)}</span><span>◷ ${dateLabel(item.reported_date)}</span><span>by ${escapeHtml(item.reporter_name)}</span></div><p>${escapeHtml(item.description)}</p><div class="detail-meta-grid"><div><span>Category</span><b>${escapeHtml(item.category)}</b></div><div><span>Color</span><b>${escapeHtml(item.color || "Not provided")}</b></div><div><span>Brand / model</span><b>${escapeHtml(item.brand || "Not provided")}</b></div><div><span>Report status</span><b>${escapeHtml(item.status)}</b></div></div>${item.can_claim ? `<button class="button" data-action="open-claim" data-id="${item.id}" data-title="${escapeHtml(item.title)}">Claim this item <span>→</span></button>` : item.is_owner ? '<p style="margin:0;color:var(--blue);font-size:11px;font-weight:800">This is your report.</p>' : '<p style="margin:0;color:var(--muted);font-size:11px">Sign in to begin a verified ownership claim.</p>'}</div></div>${item.is_owner ? `<section class="matches-inline"><div class="section-heading"><div><p class="overline">Automatic matching</p><h2>Possible opposite reports</h2></div></div><div class="match-list">${matches.length ? matches.map((match) => `<div class="match-row"><div class="score-ring">${match.score}%</div><div><h3>${escapeHtml(match.title)}</h3><p>${escapeHtml(match.reasons.join(" · "))}</p></div><button class="small-link" data-action="view-item" data-id="${match.id}">Open</button></div>`).join("") : emptyState("No potential matches", "We will keep checking new reports for a match.")}</div></section>` : ""}`;
    dialogOpen(itemDialog);
  } catch (exception) { toast(exception.message, "error"); }
}

function openClaim(id, title) {
  if (!state.user) return dialogOpen(authDialog);
  itemDialog.close();
  claimDialog.innerHTML = `<button class="close-dialog" data-close="claimDialog" aria-label="Close">×</button><p class="overline">Ownership verification</p><h2>Claim “${escapeHtml(title)}”</h2><p>Give details that the finder did not publish. An administrator will review your answers before arranging the return.</p><form class="claim-form" id="claimForm" data-item-id="${id}"><div class="form-field"><label>What was inside or with the item?</label><textarea name="ownership_details" required maxlength="600" placeholder="e.g. which cards, notes, keys, or accessories were with it?"></textarea></div><div class="form-field"><label>Exact brand / model (if known)</label><input name="exact_brand" maxlength="100" placeholder="e.g. Wildhorn or product model" /></div><div class="form-field"><label>Unique marking or identifying feature</label><input name="unique_mark" maxlength="300" placeholder="e.g. a scratch, engraving, sticker, or serial number" /></div><div class="form-field"><label>Where did you last have it?</label><select name="lost_location">${selectOptions(locations, "", "Select a location")}</select></div><button class="button button-full" type="submit">Submit for review <span>→</span></button><p class="form-feedback" id="claimFeedback"></p></form>`;
  dialogOpen(claimDialog);
  document.querySelector("#claimForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const response = await api(`/api/items/${event.currentTarget.dataset.itemId}/claim`, { method: "POST", body: JSON.stringify(body) });
      claimDialog.close(); toast(response.message); setRoute("claims");
    } catch (exception) { document.querySelector("#claimFeedback").textContent = exception.message; }
    finally { button.disabled = false; }
  });
}

async function openNotifications() {
  if (!state.user) return dialogOpen(authDialog);
  const { notifications } = await api("/api/notifications");
  state.notices = notifications; updateChrome();
  noticesDialog.innerHTML = `<button class="close-dialog" data-close="notificationsDialog" aria-label="Close">×</button><p class="overline">Your inbox</p><h2>Notifications</h2><div class="notice-list">${notifications.length ? notifications.map((notice) => `<article class="notice${notice.is_read ? "" : " unread"}" data-action="read-notice" data-id="${notice.id}" data-link="${escapeHtml(notice.link)}"><h3>${escapeHtml(notice.title)}</h3><p>${escapeHtml(notice.message)}</p><time>${timeLabel(notice.created_at)}</time></article>`).join("") : emptyState("No notifications", "Updates about matches and claims will appear here.")}</div>`;
  dialogOpen(noticesDialog);
}

function openProfile() {
  if (!state.user) return dialogOpen(authDialog);
  profileDialog.innerHTML = `<button class="close-dialog" data-close="profileDialog" aria-label="Close">×</button><div class="profile-card"><div class="profile-avatar">${initials(state.user.name)}</div><h2>${escapeHtml(state.user.name)}</h2><p>${escapeHtml(state.user.email)}</p></div><div class="profile-meta"><div><span>Department</span><b>${escapeHtml(state.user.department || "Not specified")}</b></div><div><span>Access</span><b>${escapeHtml(state.user.role)}</b></div></div><button class="button button-secondary button-full" style="margin-top:17px" data-action="logout">Sign out</button>`;
  dialogOpen(profileDialog);
}

function reviewClaim(id, decision) {
  const action = decision === "approved" ? "Approve" : "Reject";
  claimDialog.innerHTML = `<button class="close-dialog" data-close="claimDialog" aria-label="Close">×</button><p class="overline">Administrator decision</p><h2>${action} this claim?</h2><p>${decision === "approved" ? "Approving sends Student Affairs pickup instructions. Mark the item returned only after the claimant collects it." : "Rejecting keeps the item in the claim workflow and informs the claimant."}</p><form class="claim-form" id="reviewForm" data-id="${id}" data-decision="${decision}"><div class="form-field"><label>Note for the claimant (optional)</label><textarea name="review_note" maxlength="800" placeholder="Add any collection or verification instruction."></textarea></div><button class="button ${decision === "rejected" ? "button-danger" : ""} button-full" type="submit">${action} claim</button><p class="form-feedback" id="reviewFeedback"></p></form>`;
  dialogOpen(claimDialog);
  document.querySelector("#reviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try {
      await api(`/api/admin/claims/${event.currentTarget.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: event.currentTarget.dataset.decision, review_note: new FormData(event.currentTarget).get("review_note") }) });
      claimDialog.close(); toast(`Claim ${event.currentTarget.dataset.decision}.`); renderAdmin();
    } catch (exception) { document.querySelector("#reviewFeedback").textContent = exception.message; }
    finally { button.disabled = false; }
  });
}

function markReturned(id) {
  claimDialog.innerHTML = `<button class="close-dialog" data-close="claimDialog" aria-label="Close">×</button><p class="overline">Student Affairs handover</p><h2>Mark item as returned?</h2><p>Confirm this only after the verified claimant has collected the item from Student Affairs.</p><form class="claim-form" id="returnForm" data-id="${id}"><button class="button button-full" type="submit">Confirm return</button><p class="form-feedback" id="returnFeedback"></p></form>`;
  dialogOpen(claimDialog);
  document.querySelector("#returnForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button"); button.disabled = true;
    try {
      await api(`/api/admin/claims/${event.currentTarget.dataset.id}/return`, { method: "POST" });
      claimDialog.close(); toast("Item marked as returned."); renderAdmin();
    } catch (exception) { document.querySelector("#returnFeedback").textContent = exception.message; }
    finally { button.disabled = false; }
  });
}

function chooseAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  document.querySelector("#loginForm").classList.toggle("hidden", tab !== "login");
  document.querySelector("#registerForm").classList.toggle("hidden", tab !== "register");
  document.querySelector("#authFeedback").textContent = "";
}

async function authSubmit(event, path) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const data = await api(path, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    state.user = data.user; authDialog.close(); toast(`Welcome${path.includes("register") ? " to Campus ReFind" : " back"}, ${state.user.name.split(" ")[0]}!`);
    await refreshNotices(); setRoute("dashboard");
  } catch (exception) { document.querySelector("#authFeedback").textContent = exception.message; }
  finally { button.disabled = false; }
}

async function refreshNotices() {
  if (!state.user) { state.notices = []; return; }
  try { state.notices = (await api("/api/notifications")).notifications; } catch { state.notices = []; }
  updateChrome();
}

document.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) { event.preventDefault(); return setRoute(routeButton.dataset.route); }
  const close = event.target.closest("[data-close]");
  if (close) { document.querySelector(`#${close.dataset.close}`).close(); return; }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const { action: name, id } = action.dataset;
  if (name === "sign-in") return dialogOpen(authDialog);
  if (name === "view-item") return showItem(id);
  if (name === "open-claim") return openClaim(id, action.dataset.title);
  if (name === "review-claim") return reviewClaim(id, action.dataset.decision);
  if (name === "mark-returned") return markReturned(id);
  if (name === "logout") {
    await api("/api/auth/logout", { method: "POST" }); state.user = null; state.notices = []; profileDialog.close(); toast("You have been signed out."); return setRoute("dashboard");
  }
  if (name === "read-notice") {
    await api(`/api/notifications/${id}/read`, { method: "POST" });
    const notice = state.notices.find((item) => item.id === Number(id)); if (notice) notice.is_read = true; updateChrome(); noticesDialog.close();
    const link = action.dataset.link || "";
    if (link.startsWith("item:")) return showItem(link.slice(5));
    if (["dashboard", "claims", "admin"].includes(link)) return setRoute(link);
  }
});

document.querySelector("#openAuth").addEventListener("click", () => dialogOpen(authDialog));
document.querySelector("#notificationButton").addEventListener("click", openNotifications);
document.querySelector("#profileButton").addEventListener("click", openProfile);
document.querySelector("#mobileMenuButton").addEventListener("click", () => document.querySelector("#mobileNav").classList.toggle("open"));
document.querySelectorAll(".auth-tab").forEach((button) => button.addEventListener("click", () => chooseAuthTab(button.dataset.authTab)));
document.querySelector("#loginForm").addEventListener("submit", (event) => authSubmit(event, "/api/auth/login"));
document.querySelector("#registerForm").addEventListener("submit", (event) => authSubmit(event, "/api/auth/register"));
window.addEventListener("hashchange", () => setRoute(location.hash.slice(1).split("?")[0] || "dashboard"));

async function initialise() {
  const hashRoute = location.hash.slice(1).split("?")[0];
  if (hashRoute) state.route = hashRoute;
  try { state.user = (await api("/api/auth/me")).user; } catch { state.user = null; }
  await refreshNotices();
  render();
}

initialise();
