import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import pg from "pg";

const { Pool } = pg;
setDefaultResultOrder("ipv4first");

const connectionString = String(process.env.DATABASE_URL || "").trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Use your Supabase session pooler connection string.");
}

const sslDisabled =
  /sslmode=disable/i.test(connectionString) ||
  String(process.env.PGSSLMODE || "").trim().toLowerCase() === "disable";

export const pool = new Pool({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  console.error("Unexpected Postgres pool error.", error);
});

export function normaliseEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export const configuredAdminEmails = new Set(
  String(process.env.CAMPUS_REFIND_ADMIN_EMAILS || "")
    .split(",")
    .map(normaliseEmail)
    .filter(Boolean),
);

export function isConfiguredAdminEmail(email) {
  return configuredAdminEmails.has(normaliseEmail(email));
}

export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function passwordMatches(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function many(sql, parameters = [], executor = pool) {
  const { rows } = await executor.query(sql, parameters);
  return rows;
}

export async function one(sql, parameters = [], executor = pool) {
  const rows = await many(sql, parameters, executor);
  return rows[0] || null;
}

export async function run(sql, parameters = [], executor = pool) {
  return executor.query(sql, parameters);
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users ((lower(email)));

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_type TEXT NOT NULL CHECK (report_type IN ('lost', 'found')),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    private_notes TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL,
    reported_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'claimed', 'returned', 'archived')),
    image_name TEXT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    claimant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ownership_details TEXT NOT NULL,
    exact_brand TEXT NOT NULL DEFAULT '',
    unique_mark TEXT NOT NULL DEFAULT '',
    lost_location TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    review_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (item_id, claimant_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_items_type_status ON items (report_type, status);
  CREATE INDEX IF NOT EXISTS idx_items_owner ON items (user_id);
  CREATE INDEX IF NOT EXISTS idx_claims_item ON claims (item_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
`;

export async function initialiseDatabase() {
  await run(schemaSql);
  await run("DELETE FROM sessions WHERE expires_at < NOW()");
}
