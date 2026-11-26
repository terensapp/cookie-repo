import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, getKV, setKV } from "./db.js";
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
const people = () => auth.listAllowed().map(({ email, name }) => ({ email, name }));
const allRecipes = () => db.prepare("SELECT data FROM recipes").all().map((r) => JSON.parse(r.data));
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
    return { id: b.id, name: b.name, bakeDate: b.bakeDate, cookies, bakers, createdAt: row.created_at };
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
  res.json({ me: people().find((p) => p.email === req.email), people: people(), recipes: allRecipes(), ...bakeState(req.email), pantry: getKV("pantry", []) });
});

app.put("/api/pantry", (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 500 || JSON.stringify(items).length > 100_000) return res.status(400).json({ error: "The pantry couldn't be saved." });
  setKV("pantry", items.filter(isPlainObject).map((i) => ({ id: String(i.id || "").slice(0, 40), item: String(i.item || "").slice(0, 120), qty: i.qty == null || i.qty === "" ? null : Number(i.qty), unit: String(i.unit || "").slice(0, 10) })));
  res.json({ ok: true });
});

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

app.put("/api/recipes/:id", (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id) || !isPlainObject(req.body)) return res.status(400).json({ error: "That recipe couldn't be saved." });
  const rec = { ...req.body, id };
  if (!String(rec.name || "").trim()) return res.status(400).json({ error: "Give the recipe a name." });
  const json = JSON.stringify(rec);
  if (json.length > 300_000) return res.status(413).json({ error: "That recipe is too large to save." });
  db.prepare(`INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(id, json, new Date().toISOString());
  res.json(rec);
});

app.delete("/api/recipes/:id", (req, res) => {
  db.prepare("DELETE FROM recipes WHERE id = ?").run(req.params.id);
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
  return b;
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
  const { name, bakeDate, copyFrom } = req.body || {};
  if (!DATE_RE.test(bakeDate || "")) return res.status(400).json({ error: "Pick a date for the bake." });
  const src = copyFrom ? getBake(String(copyFrom)) : null;
  if (copyFrom && !src) return res.status(404).json({ error: "The bake to copy from was deleted." });
  const carry = src ? { start: src.start, ovens: src.ovens, sheetsPerOven: src.sheetsPerOven, aheadAll: src.aheadAll, selections: Object.fromEntries(Object.entries(src.selections || {}).filter(([id]) => recipeExists(id)).map(([id, v]) => [id, { ...v }])) } : {};
  const b = createBake({ ...carry, name: String(name || "").trim().slice(0, 80) || bakeName(bakeDate), bakeDate });
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
    return res.json({ recipe: { ...recipe, source: page.url } });
  }
  if (kind === "text") {
    if (String(text).trim().length < 40) return res.status(400).json({ error: "Paste the full recipe, including the ingredient list." });
    source = { text: String(text).slice(0, 80000) };
  } else if (kind === "images") {
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    if (!imgs.length || imgs.some((i) => !IMAGE_TYPES.includes(i?.media_type) || typeof i.data !== "string")) {
      return res.status(400).json({ error: "Send JPEG, PNG, WebP or GIF photos." });
    }
    source = { images: imgs, text: String(text).slice(0, 2000) };
  } else return res.status(400).json({ error: "Unknown import type." });
  res.json({ recipe: await extractRecipe(source) });
}));

/* ---------- settings: who can sign in ---------- */
app.get("/api/people", (req, res) => res.json({ people: auth.listAllowed(), me: req.email }));

app.post("/api/people", (req, res) => {
  const email = auth.normEmail(req.body?.email);
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!auth.validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  auth.addAllowed(email, name, req.email);
  res.json({ people: auth.listAllowed() });
});

app.patch("/api/people/:email", (req, res) => {
  const email = auth.normEmail(req.params.email);
  auth.renameAllowed(email, String(req.body?.name || "").trim().slice(0, 60));
  res.json({ people: auth.listAllowed() });
});

app.delete("/api/people/:email", (req, res) => {
  const email = auth.normEmail(req.params.email);
  if (email === req.email) return res.status(400).json({ error: "You can't remove yourself. Ask someone else on the list to do it." });
  auth.removeAllowed(email);
  res.json({ people: auth.listAllowed() });
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
