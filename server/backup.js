/* Backup and restore, for the nightly job in the private recipe-backups repo.
   Protected by BACKUP_TOKEN (not a sign-in), so a script can call it. Without the token set, these routes don't exist. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { db, IMAGE_DIR } from "./db.js";

const FORMAT = "cookie-repo-backup", VERSION = 1;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function tokenOk(req) {
  const want = process.env.BACKUP_TOKEN || "";
  const got = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (want.length < 32 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function backupRoutes(app) {
  const router = express.Router();
  router.use((req, res, next) => (tokenOk(req) ? next() : res.status(401).json({ error: "Backup token required." })));

  /* Everything except sign-in codes and sessions. Photos are listed here and downloaded one by one. */
  router.get("/manifest", (req, res) => {
    const images = db.prepare("SELECT id, recipe_id, type, size, page, kind, created_at FROM recipe_images").all().map((im) => {
      const file = path.join(IMAGE_DIR, im.id);
      const sha256 = fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
      return { ...im, sha256 };
    });
    res.json({
      format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
      people: db.prepare("SELECT email, name, added_by, added_at FROM allowed_emails").all(),
      recipes: db.prepare("SELECT data, updated_at FROM recipes").all().map((r) => ({ ...JSON.parse(r.data), _updatedAt: r.updated_at })),
      bakes: db.prepare("SELECT data, created_at, updated_at FROM bakes").all().map((b) => ({ ...JSON.parse(b.data), _createdAt: b.created_at, _updatedAt: b.updated_at })),
      kv: Object.fromEntries(db.prepare("SELECT key, value FROM kv").all().map((r) => [r.key, JSON.parse(r.value)])),
      images,
    });
  });

  router.get("/image/:id", (req, res) => {
    const row = db.prepare("SELECT id, type FROM recipe_images WHERE id = ?").get(req.params.id);
    const file = row && path.join(IMAGE_DIR, row.id);
    if (!row || !fs.existsSync(file)) return res.status(404).json({ error: "Not found." });
    res.set("Content-Type", row.type).sendFile(file);
  });

  /* Restore merges: everything in the backup is added or updated; nothing already on this server is deleted. */
  router.post("/restore", express.json({ limit: "50mb" }), (req, res) => {
    const b = req.body || {};
    if (b.format !== FORMAT) return res.status(400).json({ error: "That isn't a Cookie Repo backup." });
    const now = new Date().toISOString(), count = { people: 0, recipes: 0, bakes: 0, kv: 0, images: 0 };
    db.exec("BEGIN");
    try {
      for (const p of b.people || []) {
        db.prepare(`INSERT INTO allowed_emails (email, name, added_by, added_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(email) DO UPDATE SET name = excluded.name`).run(String(p.email).toLowerCase(), p.name || "", p.added_by || null, p.added_at || now);
        count.people++;
      }
      for (const r of b.recipes || []) {
        if (!ID_RE.test(r.id || "")) continue;
        const { _updatedAt, images, ...rec } = r;
        db.prepare(`INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(rec.id, JSON.stringify(rec), _updatedAt || now);
        count.recipes++;
      }
      for (const k of b.bakes || []) {
        if (!ID_RE.test(k.id || "")) continue;
        const { _createdAt, _updatedAt, ...bake } = k;
        db.prepare(`INSERT INTO bakes (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(bake.id, JSON.stringify(bake), _createdAt || now, _updatedAt || now);
        count.bakes++;
      }
      for (const [key, value] of Object.entries(b.kv || {})) {
        db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
        count.kv++;
      }
      for (const im of b.images || []) {
        if (!ID_RE.test(im.id || "") || !ID_RE.test(im.recipe_id || "")) continue;
        db.prepare(`INSERT INTO recipe_images (id, recipe_id, type, size, page, has_thumb, created_at, kind) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET recipe_id = excluded.recipe_id, page = excluded.page, kind = excluded.kind`)
          .run(im.id, im.recipe_id, im.type, im.size || 0, im.page || 0, im.created_at || now, im.kind === "cookie" ? "cookie" : "original");
        count.images++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    // Which photo files the restore script still needs to send.
    const missing = (b.images || []).filter((im) => ID_RE.test(im.id || "") && !fs.existsSync(path.join(IMAGE_DIR, im.id))).map((im) => im.id);
    res.json({ restored: count, missingImages: missing });
  });

  router.put("/restore/image/:id", express.raw({ type: () => true, limit: "30mb" }), (req, res) => {
    const row = db.prepare("SELECT id FROM recipe_images WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Restore the backup data before its photos." });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Empty photo." });
    fs.writeFileSync(path.join(IMAGE_DIR, row.id), req.body);
    res.json({ ok: true });
  });

  app.use("/api/backup", (req, res, next) => (process.env.BACKUP_TOKEN ? next() : res.status(404).json({ error: "Not found." })), router);
}
