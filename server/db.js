import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const file = process.env.DATABASE_PATH || "./data/cookie-tin.db";
fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
/* Original recipe photos live next to the database, on the same volume. */
export const IMAGE_DIR = path.join(path.dirname(file), "images");
fs.mkdirSync(IMAGE_DIR, { recursive: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS allowed_emails (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    added_by TEXT,
    added_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    sent_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bakes (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recipe_images (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    page INTEGER NOT NULL DEFAULT 0,
    has_thumb INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS recipe_images_recipe ON recipe_images (recipe_id);
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getKV(key, fallback = null) {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setKV(key, value) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}
