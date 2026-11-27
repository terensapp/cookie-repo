import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { db, getKV, setKV, IMAGE_DIR } from "./db.js";
import * as auth from "./auth.js";
import { sendCode } from "./email.js";
import { extractRecipe, ExtractError } from "./extract.js";
import { fetchRecipePage } from "./fetchPage.js";
import { EXAMPLES } from "./examples.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

/* A fingerprint of the page's files. Every API reply carries it, so an open tab can tell when the app was updated under it. */
const APP_VERSION = crypto.createHash("sha256").update(["index.html", "app.js"].map((f) => fs.readFileSync(path.join(here, "..", "public", f))).join("\n")).digest("hex").slice(0, 12);
app.use("/api", (req, res, next) => { res.set("X-App-Version", APP_VERSION); next(); });
auth.seedAllowed();

/* ---------- one public address ----------
   With CANONICAL_HOST set (e.g. cookierepo.com), other hostnames such as
   www.cookierepo.com or cookie-tin.fly.dev redirect there. Health checks are left alone. */
const CANONICAL_HOST = (process.env.CANONICAL_HOST || "").trim().toLowerCase();
if (CANONICAL_HOST) {
  app.use((req, res, next) => {
    if (req.path === "/healthz" || (req.get("host") || "").toLowerCase() === CANONICAL_HOST) return next();
    res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  });
}

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000",
  });
  next();
});

app.use("/api", express.json({ limit: "25mb" }));

/* Reject cross-site writes: browsers always send Origin on these requests. */
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  const origin = req.get("origin");
  if (origin && new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-site request refused." });
  next();
});

/* ---------- tiny in-memory rate limiter ---------- */
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.every((t) => now - t > 3600_000)) hits.delete(k); }, 600_000).unref();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- sign in ---------- */
app.post("/api/auth/request", wrap(async (req, res) => {
  const email = auth.normEmail(req.body?.email);
  if (!auth.validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (limit(`req:${req.ip}`, 10, 15 * 60_000)) return res.status(429).json({ error: "Too many tries. Wait a few minutes and try again." });
  // Same answer whether or not the address is on the list, so the list can't be probed.
  const reply = { ok: true, message: "If that address is on the list, a 6-digit code is on its way. It works for 10 minutes." };
  if (!auth.isAllowed(email)) return res.json(reply);
  const code = auth.issueCode(email);
  if (code) {
    try { await sendCode(email, code); } catch (err) {
      console.error("Email send failed:", err.message);
      return res.status(502).json({ error: "The sign-in email couldn't be sent. Try again in a minute." });
    }
  }
  res.json(reply);
}));

app.post("/api/auth/verify", (req, res) => {
  const email = auth.normEmail(req.body?.email);
  if (limit(`verify:${req.ip}`, 20, 15 * 60_000)) return res.status(429).json({ error: "Too many tries. Wait a few minutes and try again." });
  if (!auth.isAllowed(email) || !auth.verifyCode(email, req.body?.code)) return res.status(401).json({ error: "That code didn't work. Check it, or send a new one." });
  res.set("Set-Cookie", auth.sessionCookie(auth.createSession(email), req)).json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  auth.destroySession(req);
  res.set("Set-Cookie", auth.clearCookie()).json({ ok: true });
});

/* Everything below needs a signed-in, still-allowed email. */
app.use("/api", (req, res, next) => {
  const email = auth.sessionEmail(req);
  if (!email) return res.status(401).json({ error: "Sign in to continue." });
  req.email = email;
  next();
});

/* ---------- data ---------- */
const people = () => { const m = memberOf(); return auth.listAllowed().map(({ email, name }) => ({ email, name, pantry: m[email] || "" })); };
function imagesByRecipe() {
  const m = new Map();
  for (const i of db.prepare("SELECT id, recipe_id, type, size, page, has_thumb FROM recipe_images ORDER BY page, created_at").all()) {
    if (!m.has(i.recipe_id)) m.set(i.recipe_id, []);
    m.get(i.recipe_id).push({ id: i.id, type: i.type, size: i.size, thumb: !!i.has_thumb });
  }
  return m;
}
const recipeImages = (id) => imagesByRecipe().get(id) || [];
const allRecipes = () => {
  const imgs = imagesByRecipe();
  return db.prepare("SELECT data FROM recipes").all().map((r) => { const rec = JSON.parse(r.data); rec.images = imgs.get(rec.id) || []; return rec; });
};
const DEFAULT_PLAN = { start: "09:00", ovens: 1, sheetsPerOven: 2, aheadAll: false, selections: {}, have: {}, notes: "" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const bakeName = (date) => (DATE_RE.test(date || "") ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)} bake` : "Bake day");
const nextSaturday = () => { const d = new Date(); d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7)); return d.toISOString().slice(0, 10); };

/* ---------- bakes: each bake day keeps its own plan, cookies and shopping checks ---------- */
const getBake = (id) => { const r = db.prepare("SELECT data FROM bakes WHERE id = ?").get(id); return r ? JSON.parse(r.data) : null; };
function putBake(bake) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO bakes (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(bake.id, JSON.stringify(bake), now, now);
  return bake;
}
const recipeExists = (id) => !!db.prepare("SELECT 1 FROM recipes WHERE id = ?").get(id);
const createBake = (fields) => putBake({ ...DEFAULT_PLAN, bakeDate: nextSaturday(), ...fields, id: crypto.randomUUID() });
function bakeList() {
  const names = new Map(allRecipes().map((r) => [r.id, r.name]));
  return db.prepare("SELECT data, created_at FROM bakes").all().map((row) => {
    const b = JSON.parse(row.data);
    const cookies = Object.entries(b.selections || {}).map(([id, v]) => names.get(id) || v?.name || "Deleted recipe");
    const bakers = [...new Set(Object.values(b.selections || {}).map((v) => v?.baker).filter(Boolean))];
    // Selections ride along so a shopping list can combine several bakes.
    const selections = Object.fromEntries(Object.entries(b.selections || {}).map(([id, v]) => [id, { scale: v?.scale, baker: v?.baker || "", name: v?.name || names.get(id) || "" }]));
    return { id: b.id, name: b.name, bakeDate: b.bakeDate, partOf: b.partOf || "", pantryId: b.pantryId, usePantry: b.usePantry, mixOnly: !!b.mixOnly, cookies, bakers, selections, createdAt: row.created_at };
  }).sort((a, b) => String(b.bakeDate).localeCompare(String(a.bakeDate)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
/* The bake a person has open; new people land on the most recent one. */
function openBake(email) {
  const id = getKV(`open:${email}`, null);
  const b = id && getBake(id);
  if (b) return b;
  const latest = bakeList()[0];
  return latest ? getBake(latest.id) : createBake({ name: bakeName(nextSaturday()) });
}
const bakeState = (email) => ({ plan: openBake(email), bakes: bakeList() });

/* First start after bakes were added: the existing plan becomes the first saved bake. */
if (!db.prepare("SELECT 1 FROM bakes LIMIT 1").get()) {
  const old = getKV("plan", null);
  if (old) createBake({ ...old, name: old.name || bakeName(old.bakeDate) });
}

app.get("/api/state", (req, res) => {
  res.json({ me: people().find((p) => p.email === req.email), people: people(), recipes: allRecipes(), ...bakeState(req.email), pantries: getPantries() });
});

/* ---------- pantries: one per kitchen; people and bakes each point at one ---------- */
function getPantries() {
  let list = getKV("pantries", null);
  if (!list) { list = [{ id: "main", name: "Our pantry", items: getKV("pantry", []) }]; setKV("pantries", list); } // the single pantry from before
  return list;
}
const memberOf = () => getKV("memberOf", {});
/* New bakes start with their creator's pantry. */
const personPantry = (email) => { const list = getPantries(), id = memberOf()[email]; return list.find((p) => p.id === id)?.id || list[0]?.id || ""; };
const cleanItems = (items) => items.filter(isPlainObject).map((i) => ({ id: String(i.id || "").slice(0, 40), item: String(i.item || "").slice(0, 120), qty: i.qty == null || i.qty === "" || !Number.isFinite(Number(i.qty)) ? null : Number(i.qty), unit: String(i.unit || "").slice(0, 10) }));

app.post("/api/pantries", (req, res) => {
  const list = getPantries();
  if (list.length >= 20) return res.status(400).json({ error: "That's a lot of pantries. Remove one first." });
  const p = { id: crypto.randomUUID(), name: String(req.body?.name || "").trim().slice(0, 60) || "New pantry", items: [] };
  setKV("pantries", [...list, p]);
  res.json({ pantry: p, pantries: getPantries() });
});
app.put("/api/pantries/:id", (req, res) => {
  const list = getPantries(), p = list.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "That pantry was removed." });
  const { name, items } = req.body || {};
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length > 500 || JSON.stringify(items).length > 100_000) return res.status(400).json({ error: "The pantry couldn't be saved." });
    p.items = cleanItems(items);
  }
  if (name !== undefined) p.name = String(name).trim().slice(0, 60) || p.name;
  setKV("pantries", list);
  res.json({ ok: true });
});
app.delete("/api/pantries/:id", (req, res) => {
  const id = req.params.id;
  setKV("pantries", getPantries().filter((p) => p.id !== id));
  const m = memberOf(); for (const k of Object.keys(m)) if (m[k] === id) delete m[k]; setKV("memberOf", m);
  for (const s of bakeList()) { const b = getBake(s.id); if (b.pantryId === id) { b.pantryId = ""; putBake(b); } }
  res.json({ ok: true });
});

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

app.put("/api/recipes/:id", (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id) || !isPlainObject(req.body)) return res.status(400).json({ error: "That recipe couldn't be saved." });
  const { images: _ignored, notes: _notes, ...body } = req.body;
  // Notes are added and removed through their own routes, so editing a recipe never drops someone's new note.
  const prev = db.prepare("SELECT data FROM recipes WHERE id = ?").get(id);
  const rec = { ...body, id, notes: prev ? JSON.parse(prev.data).notes || [] : [] };
  if (!String(rec.name || "").trim()) return res.status(400).json({ error: "Give the recipe a name." });
  const json = JSON.stringify(rec);
  if (json.length > 300_000) return res.status(413).json({ error: "That recipe is too large to save." });
  db.prepare(`INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(id, json, new Date().toISOString());
  res.json({ ...rec, images: recipeImages(id) });
});

app.delete("/api/recipes/:id", (req, res) => {
  db.prepare("DELETE FROM recipes WHERE id = ?").run(req.params.id);
  for (const { id } of db.prepare("SELECT id FROM recipe_images WHERE recipe_id = ?").all(req.params.id)) removeImage(id);
  res.json({ ok: true }); // saved bakes keep the recipe's name, so past bakes still say what was made
});

function cleanBake(body, id) {
  if (!isPlainObject(body) || JSON.stringify(body).length > 100_000) return null;
  const b = { ...body, id };
  b.name = String(b.name || "").trim().slice(0, 80) || bakeName(b.bakeDate);
  if (!DATE_RE.test(b.bakeDate || "")) b.bakeDate = nextSaturday();
  b.notes = String(b.notes || "").slice(0, 5000);
  if (!isPlainObject(b.selections)) b.selections = {};
  if (!isPlainObject(b.have)) b.have = {};
  b.partOf = mainBakeId(b.partOf, id);
  b.shopScope = ["this", "pantry", "event", "custom"].includes(b.shopScope) ? b.shopScope : "this";
  b.shopBakes = Array.isArray(b.shopBakes) ? b.shopBakes.filter((x) => typeof x === "string" && ID_RE.test(x)).slice(0, 50) : [];
  b.usePantry = b.usePantry !== false;
  b.mixOnly = !!(b.mixOnly && b.partOf); // only a prebake can hand its doughs to the main bake
  // Which pantry this bake's shopping list subtracts. "" = none; missing = the first pantry (bakes from before).
  if (b.pantryId !== undefined) b.pantryId = typeof b.pantryId === "string" && getPantries().some((p) => p.id === b.pantryId) ? b.pantryId : "";
  return b;
}
/* Prebakes hang off one main bake, one level deep: pointing at a prebake means its main bake. */
function mainBakeId(partOf, selfId) {
  if (!partOf || typeof partOf !== "string" || partOf === selfId) return "";
  const parent = getBake(partOf);
  if (!parent) return "";
  const top = parent.partOf && parent.partOf !== selfId && getBake(parent.partOf) ? parent.partOf : parent.id;
  if (top === selfId) return "";
  // A bake that already has its own prebakes stays a main bake.
  if (bakeList().some((b) => b.partOf === selfId)) return "";
  return top;
}

app.put("/api/bakes/:id", (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id) || !getBake(id)) return res.status(404).json({ error: "That bake was deleted. Pick another one from Bakes." });
  const b = cleanBake(req.body, id);
  if (!b) return res.status(400).json({ error: "The plan couldn't be saved." });
  putBake(b);
  res.json({ ok: true });
});

/* New bake, empty or with the cookies, batch sizes, bakers and oven setup of an earlier one. */
app.post("/api/bakes", (req, res) => {
  const { name, bakeDate, copyFrom, partOf } = req.body || {};
  if (!DATE_RE.test(bakeDate || "")) return res.status(400).json({ error: "Pick a date for the bake." });
  const src = copyFrom ? getBake(String(copyFrom)) : null;
  if (copyFrom && !src) return res.status(404).json({ error: "The bake to copy from was deleted." });
  const carry = src ? { start: src.start, ovens: src.ovens, sheetsPerOven: src.sheetsPerOven, aheadAll: src.aheadAll, selections: Object.fromEntries(Object.entries(src.selections || {}).filter(([id]) => recipeExists(id)).map(([id, v]) => [id, { ...v }])) } : {};
  const b = createBake({ ...carry, name: String(name || "").trim().slice(0, 80) || bakeName(bakeDate), bakeDate, pantryId: personPantry(req.email) });
  if (partOf) { b.partOf = mainBakeId(String(partOf), b.id); putBake(b); }
  setKV(`open:${req.email}`, b.id);
  res.json(bakeState(req.email));
});

app.post("/api/bakes/:id/open", (req, res) => {
  if (!getBake(req.params.id)) return res.status(404).json({ error: "That bake was deleted." });
  setKV(`open:${req.email}`, req.params.id);
  res.json(bakeState(req.email));
});

app.delete("/api/bakes/:id", (req, res) => {
  db.prepare("DELETE FROM bakes WHERE id = ?").run(req.params.id);
  // Its prebakes stay, as bakes of their own.
  for (const s of bakeList().filter((b) => b.partOf === req.params.id)) { const b = getBake(s.id); b.partOf = ""; putBake(b); }
  res.json(bakeState(req.email));
});

app.post("/api/examples", (req, res) => {
  const ins = db.prepare("INSERT OR IGNORE INTO recipes (id, data, updated_at) VALUES (?, ?, ?)");
  for (const r of EXAMPLES) ins.run(r.id, JSON.stringify({ ...r, owner: req.email, createdAt: new Date().toISOString() }), new Date().toISOString());
  res.json({ recipes: allRecipes() });
});

/* ---------- Claude reads a recipe ---------- */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
app.post("/api/extract", wrap(async (req, res) => {
  if (limit(`extract:${req.email}`, 40, 3600_000)) return res.status(429).json({ error: "That's a lot of recipes for one hour. Try again a bit later." });
  const { kind, text = "", url = "", images = [] } = req.body || {};
  let source;
  if (kind === "url") {
    const page = await fetchRecipePage(url);
    source = { text: page.text };
    const recipe = await extractRecipe(source);
    return res.json({ recipe: { ...recipe, link: page.url } });
  }
  if (kind === "text") {
    if (String(text).trim().length < 40) return res.status(400).json({ error: "Paste the full recipe, including the ingredient list." });
    source = { text: String(text).slice(0, 80000) };
  } else if (kind === "images") {
    const imgs = Array.isArray(images) ? images.slice(0, 8) : [];
    if (!imgs.length || imgs.some((i) => !IMAGE_TYPES.includes(i?.media_type) || typeof i.data !== "string")) {
      return res.status(400).json({ error: "Send JPEG, PNG, WebP or GIF photos." });
    }
    source = { images: imgs, text: String(text).slice(0, 2000) };
  } else return res.status(400).json({ error: "Unknown import type." });
  res.json({ recipe: await extractRecipe(source) });
}));

/* ---------- recipe notes: stamped by the server with the time and the signed-in person ---------- */
function updateRecipe(id, fn) {
  const row = db.prepare("SELECT data FROM recipes WHERE id = ?").get(id);
  if (!row) return null;
  const rec = JSON.parse(row.data); fn(rec);
  db.prepare("UPDATE recipes SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(rec), new Date().toISOString(), id);
  return { ...rec, images: recipeImages(id) };
}
app.post("/api/recipes/:id/notes", (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: "Write the note first." });
  const rec = updateRecipe(req.params.id, (r) => { r.notes = [...(r.notes || []), { id: crypto.randomUUID(), text, at: new Date().toISOString(), by: req.email }]; });
  if (!rec) return res.status(404).json({ error: "That recipe was deleted." });
  res.json(rec);
});
app.patch("/api/recipes/:id/notes/:noteId", (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: "A note can't be empty. Delete it instead." });
  let found = false;
  const rec = updateRecipe(req.params.id, (r) => {
    r.notes = (r.notes || []).map((n) => (n.id === req.params.noteId ? ((found = true), { ...n, text, editedAt: new Date().toISOString(), editedBy: req.email }) : n));
  });
  if (!rec) return res.status(404).json({ error: "That recipe was deleted." });
  if (!found) return res.status(404).json({ error: "That note was deleted." });
  res.json(rec);
});
app.delete("/api/recipes/:id/notes/:noteId", (req, res) => {
  const rec = updateRecipe(req.params.id, (r) => { r.notes = (r.notes || []).filter((n) => n.id !== req.params.noteId); });
  if (!rec) return res.status(404).json({ error: "That recipe was deleted." });
  res.json(rec);
});

/* ---------- original recipe photos ---------- */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024, MAX_IMAGES_PER_RECIPE = 12;
/* Trust the file's own bytes, not the browser's label. Only plain photo formats are kept. */
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 4, 8) === "ftyp") {
    const brand = b.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (brand === "avif") return "image/avif";
  }
  return null;
}
const imagePath = (id, thumb) => path.join(IMAGE_DIR, thumb ? `${id}.thumb` : id);
function removeImage(id) {
  db.prepare("DELETE FROM recipe_images WHERE id = ?").run(id);
  for (const t of [false, true]) fs.rm(imagePath(id, t), { force: true }, () => {});
}
const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

app.post("/api/recipes/:id/images", rawImage, (req, res) => {
  const { id } = req.params;
  if (!db.prepare("SELECT 1 FROM recipes WHERE id = ?").get(id)) return res.status(404).json({ error: "Save the recipe before adding photos." });
  if (limit(`img:${req.email}`, 120, 3600_000)) return res.status(429).json({ error: "Too many photos for one hour. Try again later." });
  const count = db.prepare("SELECT COUNT(*) AS n FROM recipe_images WHERE recipe_id = ?").get(id).n;
  if (count >= MAX_IMAGES_PER_RECIPE) return res.status(400).json({ error: `A recipe can keep up to ${MAX_IMAGES_PER_RECIPE} photos.` });
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  const type = buf && sniffImage(buf);
  if (!type) return res.status(400).json({ error: "That file isn't a photo Cookie Repo can keep (JPEG, PNG, HEIC, WebP or GIF)." });
  const imgId = crypto.randomUUID();
  fs.writeFileSync(imagePath(imgId), buf);
  const page = Number.isInteger(Number(req.query.page)) ? Number(req.query.page) : count;
  db.prepare("INSERT INTO recipe_images (id, recipe_id, type, size, page, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(imgId, id, type, buf.length, page, new Date().toISOString());
  res.json({ id: imgId, images: recipeImages(id) });
});

/* A small JPEG preview made by the browser, so lists don't load full-size photos. */
app.put("/api/images/:imgId/thumb", express.raw({ type: () => true, limit: 2 * 1024 * 1024 }), (req, res) => {
  const row = db.prepare("SELECT recipe_id FROM recipe_images WHERE id = ?").get(req.params.imgId);
  if (!row) return res.status(404).json({ error: "That photo was removed." });
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || sniffImage(buf) !== "image/jpeg") return res.status(400).json({ error: "Preview must be a JPEG." });
  fs.writeFileSync(imagePath(req.params.imgId, true), buf);
  db.prepare("UPDATE recipe_images SET has_thumb = 1 WHERE id = ?").run(req.params.imgId);
  res.json({ images: recipeImages(row.recipe_id) });
});

app.get("/api/images/:imgId", (req, res) => {
  const row = db.prepare("SELECT id, type, has_thumb FROM recipe_images WHERE id = ?").get(req.params.imgId);
  if (!row) return res.status(404).json({ error: "Photo not found." });
  const thumb = req.query.size === "thumb" && row.has_thumb;
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/avif": "avif" }[row.type] || "img";
  res.set({
    "Content-Type": thumb ? "image/jpeg" : row.type,
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="recipe-photo.${thumb ? "jpg" : ext}"`,
  });
  res.sendFile(imagePath(row.id, thumb));
});

app.delete("/api/images/:imgId", (req, res) => {
  const row = db.prepare("SELECT recipe_id FROM recipe_images WHERE id = ?").get(req.params.imgId);
  if (!row) return res.json({ images: [] });
  removeImage(req.params.imgId);
  res.json({ images: recipeImages(row.recipe_id) });
});

/* ---------- settings: who can sign in ---------- */
app.get("/api/people", (req, res) => res.json({ people: auth.listAllowed(), me: req.email }));

app.post("/api/people", (req, res) => {
  const email = auth.normEmail(req.body?.email);
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!auth.validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  auth.addAllowed(email, name, req.email);
  res.json({ people: people() });
});

app.patch("/api/people/:email", (req, res) => {
  const email = auth.normEmail(req.params.email);
  if (req.body?.name !== undefined) auth.renameAllowed(email, String(req.body.name || "").trim().slice(0, 60));
  if (req.body?.pantry !== undefined) {
    const m = memberOf(), fam = String(req.body.pantry || "");
    if (fam && getPantries().some((p) => p.id === fam)) m[email] = fam; else delete m[email];
    setKV("memberOf", m);
  }
  res.json({ people: people() });
});

app.delete("/api/people/:email", (req, res) => {
  const email = auth.normEmail(req.params.email);
  if (email === req.email) return res.status(400).json({ error: "You can't remove yourself. Ask someone else on the list to do it." });
  auth.removeAllowed(email);
  res.json({ people: people() });
});

/* ---------- errors, static files ---------- */
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => {
  if (err instanceof ExtractError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That upload is too large. Try fewer or smaller photos." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.get("/healthz", (req, res) => res.send("ok"));
app.use(express.static(path.join(here, "..", "public"), { extensions: ["html"], maxAge: 0 /* revalidate by ETag, so a deploy reaches everyone at once */ }));
app.get("/{*any}", (req, res) => res.sendFile(path.join(here, "..", "public", "index.html")));

app.listen(PORT, () => console.log(`Cookie Repo listening on :${PORT}`));
