import crypto from "node:crypto";
import { db } from "./db.js";

const PROD = process.env.NODE_ENV === "production";
const SECRET = process.env.SESSION_SECRET || (PROD ? null : "dev-only-secret");
if (!SECRET) throw new Error("SESSION_SECRET must be set in production");

export const COOKIE = "ct_session";
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 45 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const hmac = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("hex");

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** On first start, let the addresses in BOOTSTRAP_EMAILS in so someone can sign in and add the rest. */
export function seedAllowed() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM allowed_emails").get();
  if (n > 0) return;
  const list = String(process.env.BOOTSTRAP_EMAILS || "").split(",").map(normEmail).filter(validEmail);
  const ins = db.prepare("INSERT OR IGNORE INTO allowed_emails (email, added_by, added_at) VALUES (?, 'setup', ?)");
  for (const e of list) ins.run(e, new Date().toISOString());
  if (!list.length) console.warn("No allowed emails yet. Set BOOTSTRAP_EMAILS so the first person can sign in.");
}

export const isAllowed = (email) => !!db.prepare("SELECT 1 FROM allowed_emails WHERE email = ?").get(email);

export function listAllowed() {
  return db.prepare("SELECT email, name, added_by AS addedBy, added_at AS addedAt FROM allowed_emails ORDER BY email").all();
}

export function addAllowed(email, name, by) {
  db.prepare(`INSERT INTO allowed_emails (email, name, added_by, added_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET name = excluded.name`).run(email, name, by, new Date().toISOString());
}

export function renameAllowed(email, name) {
  db.prepare("UPDATE allowed_emails SET name = ? WHERE email = ?").run(name, email);
}

export function removeAllowed(email) {
  db.prepare("DELETE FROM allowed_emails WHERE email = ?").run(email);
  db.prepare("DELETE FROM sessions WHERE email = ?").run(email);
  db.prepare("DELETE FROM login_codes WHERE email = ?").run(email);
}

/** Returns a fresh 6-digit code, or null if one was sent too recently. */
export function issueCode(email) {
  const now = Date.now();
  const prev = db.prepare("SELECT sent_at FROM login_codes WHERE email = ?").get(email);
  if (prev && now - prev.sent_at < RESEND_AFTER_MS) return null;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  db.prepare(`INSERT INTO login_codes (email, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, 0)
              ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = 0`)
    .run(email, hmac(`${email}:${code}`), now + CODE_TTL_MS, now);
  return code;
}

export function verifyCode(email, code) {
  const row = db.prepare("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?").get(email);
  if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) return false;
  const given = Buffer.from(hmac(`${email}:${String(code || "").replace(/\D/g, "")}`));
  const ok = given.length === row.code_hash.length && crypto.timingSafeEqual(given, Buffer.from(row.code_hash));
  if (ok) db.prepare("DELETE FROM login_codes WHERE email = ?").run(email);
  else db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").run(email);
  return ok;
}

export function createSession(email) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)").run(hmac(token), email, Date.now() + SESSION_TTL_MS);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  return token;
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** The signed-in email for this request, or null. A removed email loses access at once. */
export function sessionEmail(req) {
  const token = readCookie(req);
  if (!token) return null;
  const row = db.prepare("SELECT email, expires_at FROM sessions WHERE token_hash = ?").get(hmac(token));
  if (!row || row.expires_at < Date.now() || !isAllowed(row.email)) return null;
  return row.email;
}

export function destroySession(req) {
  const token = readCookie(req);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hmac(token));
}

export function sessionCookie(token, req) {
  const secure = PROD || req.secure ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
