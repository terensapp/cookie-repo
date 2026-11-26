"use strict";
/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = s => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : new Date(); };
const fmtDay = d => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
const toMin = s => { const [h, m] = String(s || "09:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmtT = m => { m = Math.round(m); const h24 = Math.floor(m / 60) % 24, mm = String(m % 60).padStart(2, "0"); const h = h24 % 12 || 12; return `${h}:${mm} ${h24 < 12 ? "AM" : "PM"}`; };
const fmtDur = m => { m = Math.round(m); if (m < 60) return `${m} min`; if (m >= 720) return `${Math.round(m / 60)} h`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; };
const safeUrl = u => /^https?:\/\/[^\s]+$/i.test(String(u || "").trim()) ? String(u).trim() : "";
const fixLink = u => { u = String(u || "").trim().replace(/[).,;]+$/, ""); if (!u) return ""; if (!/^https?:\/\//i.test(u) && /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u)) u = "https://" + u; return safeUrl(u); };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

const UNITS = ["", "tsp", "tbsp", "cup", "g", "kg", "oz", "lb", "ml", "l", "stick", "each", "pinch"];
const CATS = ["Baking staples", "Dairy & eggs", "Sugar & sweeteners", "Mix-ins", "Spices & extracts", "Produce", "Other"];
const SCALES = [0.5, 1, 1.5, 2, 2.5, 3, 4];

const FR = [[0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"], [1, ""]];
function frac(x) {
  if (!Number.isFinite(x)) return "";
  let w = Math.floor(x + 1e-9), f = x - w, best = FR[0], bd = 2;
  for (const p of FR) { const d = Math.abs(f - p[0]); if (d < bd) { bd = d; best = p; } }
  if (best[0] === 1) { w += 1; best = FR[0]; }
  if (w === 0 && !best[1]) return x > 0 ? "⅛" : "0";
  return (w ? String(w) : "") + best[1];
}
const scaleLabel = s => s === 0.5 ? "½×" : `${frac(s)}×`;
function parseQty(s) {
  s = String(s ?? "").trim(); if (!s) return null;
  const U = { "½": .5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": .25, "¾": .75, "⅛": .125, "⅜": .375, "⅝": .625, "⅞": .875 };
  s = s.replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, c => " " + U[c]);
  let t = 0, ok = false;
  for (const p of s.split(/[\s-]+/)) { if (!p) continue; if (p.includes("/")) { const [a, b] = p.split("/").map(Number); if (b) { t += a / b; ok = true; } } else if (!isNaN(Number(p))) { t += Number(p); ok = true; } }
  return ok ? Math.round(t * 1000) / 1000 : null;
}
function qtyText(q, unit) {
  if (q == null || q === "") return "";
  q = Number(q);
  if (unit === "g" || unit === "ml") return String(Math.round(q));
  if (["kg", "l", "lb", "oz"].includes(unit)) return String(Math.round(q * 100) / 100);
  return frac(q);
}
function unitText(unit, q) {
  if (!unit || unit === "each") return "";
  if (unit === "cup") return q > 1.06 ? "cups" : "cup";
  if (unit === "stick") return q > 1.06 ? "sticks" : "stick";
  return unit;
}

/* ---------- state ---------- */
const TABS = ["recipes", "plan", "shopping", "settings"];
function defaultPlan() { const d = new Date(); d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7)); return { id: "", name: "", bakeDate: isoDate(d), start: "09:00", ovens: 1, sheetsPerOven: 2, aheadAll: false, selections: {}, have: {}, notes: "" }; }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const bakeNameFor = date => /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)} bake` : "Bake day";
const S = {
  recipes: [], loaded: false, signedIn: null, loadError: "", plan: defaultPlan(), bakes: [], pantries: [], bakeForm: null, confirmBake: null, me: { email: "", name: "" }, people: [], pantry: [],
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "recipes",
  modal: null, viewScale: {}, confirmDelete: null, bakerFilter: "", shopFilter: "",
  login: { step: "email", email: "", busy: false, msg: "", err: false },
};
const IMG_MAX = 8;
const TOUCH = matchMedia("(pointer: coarse)").matches;

/* ---------- server ---------- */
async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  } catch { throw { status: 0, message: "Can't reach Cookie Repo. Check your connection and try again." }; }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/")) { S.signedIn = false; S.loaded = true; render(); }
  if (!res.ok) throw { status: res.status, message: data.error || "Something went wrong. Try again." };
  return data;
}
async function loadState() {
  try {
    const d = await api("GET", "/api/state");
    S.signedIn = true; S.me = d.me || { email: "", name: "" }; S.people = d.people || [];
    S.recipes = (d.recipes || []).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!Object.keys(pantryTimers).length) S.pantries = Array.isArray(d.pantries) ? d.pantries : [];
    if (!planTimer && !planWriting) applyBakes(d);
    S.loaded = true; S.loadError = "";
  } catch (e) { if (e.status !== 401) S.loadError = e.message; S.loaded = true; }
  render();
}
const byDate = (a, b) => String(a.bakeDate).localeCompare(String(b.bakeDate)) || String(a.name).localeCompare(String(b.name));
/* The open bake's summary, kept in step with unsaved edits. */
const liveBake = b => b.id === S.plan.id ? { ...b, name: S.plan.name, bakeDate: S.plan.bakeDate, partOf: S.plan.partOf || "", pantryId: S.plan.pantryId, usePantry: S.plan.usePantry, selections: S.plan.selections || {} } : b;
const allBakes = () => S.bakes.map(liveBake);
const mainOf = b => (b.partOf && S.bakes.some(x => x.id === b.partOf)) ? b.partOf : b.id;
/* A main bake followed by its prebakes, in date order. */
function family(id = S.plan.id) {
  const all = allBakes(), me = all.find(b => b.id === id); if (!me) return [];
  const main = all.find(b => b.id === mainOf(me));
  return [main, ...all.filter(b => b.partOf === main.id && b.id !== main.id).sort(byDate)];
}
function shopBakeIds() {
  const P = S.plan, all = allBakes();
  if (P.shopScope === "event") return family().map(b => b.id);
  if (P.shopScope === "pantry") { const pid = pantryIdOf(P); return family().filter(b => pantryIdOf(b) === pid).map(b => b.id); }
  if (P.shopScope === "custom") { const ids = (P.shopBakes || []).filter(id => all.some(b => b.id === id)); return ids.length ? ids : [P.id]; }
  return [P.id];
}
/* Every cookie on the bakes this list covers, each with its own batch size and baker. */
function shopSelections() {
  const all = allBakes();
  return shopBakeIds().flatMap(id => { const b = all.find(x => x.id === id); return Object.entries(b?.selections || {}).map(([rid, v]) => ({ r: getR(rid), scale: num(v && v.scale) || 1, baker: (v && v.baker) || "", bake: b.name })).filter(x => x.r); });
}
function applyBakes(d) {
  S.plan = { ...defaultPlan(), ...d.plan, bakeDate: d.plan?.bakeDate || defaultPlan().bakeDate };
  S.bakes = Array.isArray(d.bakes) ? d.bakes : S.bakes;
}
let planTimer = null, planWriting = false, planDirty = false;
function writeErr(e) { toast(e.message || "Couldn't save just now. Try again."); }
function savePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => { planTimer = null; planDirty = true; flushPlan(); }, 350);
  render();
}
async function flushPlan() {
  if (planWriting) return; planWriting = true;
  while (planDirty) {
    planDirty = false;
    // Keep each cookie's name with the bake, so a past bake still reads right if the recipe is later deleted.
    for (const [id, v] of Object.entries(S.plan.selections || {})) { const r = getR(id); if (r && v) v.name = r.name; }
    const sum = S.bakes.find(b => b.id === S.plan.id);
    if (sum) { sum.name = S.plan.name; sum.bakeDate = S.plan.bakeDate; sum.partOf = S.plan.partOf || ""; sum.selections = clone(S.plan.selections || {}); sum.cookies = Object.entries(S.plan.selections || {}).map(([id, v]) => getR(id)?.name || v?.name || "Deleted recipe"); }
    try { await api("PUT", `/api/bakes/${encodeURIComponent(S.plan.id)}`, S.plan); }
    catch (e) { writeErr(e); if (e.status === 404) { planWriting = false; loadState(); return; } break; }
  }
  planWriting = false;
}
/* Finish any pending save before switching to another bake. */
async function settlePlan() {
  if (planTimer) { clearTimeout(planTimer); planTimer = null; planDirty = true; }
  while (planWriting) await new Promise(r => setTimeout(r, 60));
  if (planDirty) await flushPlan();
}
async function bakeCall(method, url, body, msg) {
  await settlePlan();
  try { applyBakes(await api(method, url, body)); S.bakerFilter = ""; S.shopFilter = ""; if (msg) toast(msg); return true; }
  catch (e) { writeErr(e); return false; }
  finally { render(); if (S.modal?.type === "bakes") renderModal(); }
}
/* Pantries: one per kitchen. A bake uses one (or none); a combined shopping list subtracts every pantry its bakes use. */
const pantryTimers = {};
function savePantry(p = curPantry()) {
  if (!p) return;
  clearTimeout(pantryTimers[p.id]);
  pantryTimers[p.id] = setTimeout(async () => { try { await api("PUT", `/api/pantries/${encodeURIComponent(p.id)}`, { items: p.items, name: p.name }); } catch (e) { writeErr(e); } delete pantryTimers[p.id]; }, 400);
  render();
}
const pantryIdOf = b => b.pantryId !== undefined ? b.pantryId : (b.usePantry === false ? "" : (S.pantries[0]?.id || ""));
const pantryById = id => S.pantries.find(p => p.id === id) || null;
const curPantry = () => pantryById(pantryIdOf(S.plan));
function shopPantries() { const all = allBakes(); return [...new Set(shopBakeIds().map(id => all.find(b => b.id === id)).filter(Boolean).map(pantryIdOf))].map(pantryById).filter(Boolean); }
function putRecipe(saved) {
  const i = S.recipes.findIndex(r => r.id === saved.id);
  if (i >= 0) S.recipes[i] = saved; else S.recipes.push(saved);
  render();
}
async function saveRecipe(rec) {
  try {
    const saved = await api("PUT", `/api/recipes/${encodeURIComponent(rec.id)}`, rec);
    const i = S.recipes.findIndex(r => r.id === rec.id);
    if (i >= 0) S.recipes[i] = saved; else S.recipes.push(saved);
    S.recipes.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    render(); return true;
  } catch (e) { writeErr(e); return false; }
}
async function deleteRecipe(id) {
  try { await api("DELETE", `/api/recipes/${encodeURIComponent(id)}`); } catch (e) { writeErr(e); return; }
  if (S.plan.selections?.[id]) { delete S.plan.selections[id]; savePlan(); }
  S.recipes = S.recipes.filter(r => r.id !== id);
  render();
}
/* Pick up changes other people made: on focus and every 30 s while the page is visible and idle. */
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && /^(text|search|email|)$/.test(a.type || ""))); };
function refreshIfIdle() { if (S.signedIn && document.visibilityState === "visible" && !typing() && !planTimer && !planWriting && !(S.modal && S.modal.type !== "detail")) loadState(); }
document.addEventListener("visibilitychange", refreshIfIdle);
setInterval(refreshIfIdle, 30000);
const personName = email => { const p = S.people.find(x => x.email === email); return p ? (p.name || p.email.split("@")[0]) : (email ? email.split("@")[0] : "Unassigned"); };
function personSelect(id, value, attrs, label, includeNone) {
  const opts = S.people.map(p => `<option value="${esc(p.email)}" ${p.email === value ? "selected" : ""}>${esc(p.name || p.email)}</option>`).join("");
  const missing = value && !S.people.some(p => p.email === value) ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : "";
  return `<select id="${esc(id)}" ${attrs} aria-label="${esc(label)}">${includeNone ? `<option value="" ${value ? "" : "selected"}>${esc(includeNone)}</option>` : ""}${missing}${opts}</select>`;
}

/* ---------- selections & scaling ---------- */
const getR = id => S.recipes.find(r => r.id === id);
function selectedList() {
  return Object.entries(S.plan.selections || {}).map(([id, v]) => ({ r: getR(id), scale: num(v && v.scale) || 1, baker: (v && v.baker) || "" })).filter(x => x.r);
}
function setBaker(id, email) { if (S.plan.selections?.[id]) { S.plan.selections[id].baker = email; savePlan(); } }
function scaleOf(id) { return S.plan.selections?.[id] ? (num(S.plan.selections[id].scale) || 1) : (S.viewScale[id] || 1); }
function setScale(id, s) {
  s = Math.round(clamp(num(s) || 1, 0.25, 12) * 100) / 100;
  if (S.plan.selections?.[id]) { S.plan.selections[id].scale = s; savePlan(); } else { S.viewScale[id] = s; render(); }
}
function toggleBake(id) {
  S.plan.selections = S.plan.selections || {};
  if (S.plan.selections[id]) delete S.plan.selections[id];
  else S.plan.selections[id] = { scale: S.viewScale[id] || 1, baker: getR(id)?.owner || S.me.email };
  savePlan();
}
function scaleControl(r) {
  const s = scaleOf(r.id), y = num(r.yieldCount);
  const opts = SCALES.includes(s) ? SCALES : [...SCALES, s].sort((a, b) => a - b);
  return `<select class="inp" data-change="scale" data-id="${esc(r.id)}" aria-label="Batch size for ${esc(r.name)}">${opts.map(o => `<option value="${o}" ${o === s ? "selected" : ""}>${scaleLabel(o)} batch${y ? ` · ${Math.round(y * o)} cookies` : ""}</option>`).join("")}</select>`;
}

/* ---------- schedule ---------- */
function schedule() {
  const P = S.plan, sel = selectedList(); if (!sel.length) return null;
  const T0 = toMin(P.start), nOv = clamp(num(P.ovens) || 1, 1, 3), cap = clamp(num(P.sheetsPerOven) || 2, 1, 4), PRE = 15;
  const items = sel.map(({ r, scale, baker }, i) => {
    const yieldN = num(r.yieldCount) || 24, count = Math.max(1, Math.round(yieldN * scale)), per = Math.max(1, num(r.cookiesPerSheet) || 12);
    const prepBase = num(r.prepMinutes) || 20, prep = Math.round(prepBase * (scale > 1 ? 1 + (scale - 1) * 0.3 : 1));
    const chill = num(r.chillMinutes), keeps = num(r.doughKeepsDays);
    const ahead = chill >= 180 ? "required" : (P.aheadAll && keeps >= 1 ? "chosen" : "");
    return { r, scale, baker, color: (i % 6) + 1, count, per, sheets: Math.ceil(count / per), prep, chill, keeps, freezable: !!r.freezable, temp: num(r.ovenTempF) || 350, bake: num(r.bakeMinutes) || 11, cool: num(r.coolMinutes) || 10, deco: num(r.decorateMinutes), ahead, lastOut: 0, firstIn: null };
  });
  const before = items.filter(it => it.ahead);
  const today = items.filter(it => !it.ahead).sort((a, b) => b.chill - a.chill || a.temp - b.temp);
  let t = T0;
  for (const it of today) { it.mixStart = t; it.mixEnd = t + it.prep; t = it.mixEnd; it.ready = it.mixEnd + it.chill; }
  for (const it of before) it.ready = T0;
  const rem = []; items.forEach(it => { for (let k = 0; k < it.sheets; k++) rem.push({ it }); });
  const ovens = Array.from({ length: nOv }, (_, i) => ({ i, free: T0 + PRE, temp: null }));
  const rounds = [], ovenEvents = []; let guard = 0;
  while (rem.length && guard++ < 600) {
    const o = ovens.reduce((a, b) => b.free < a.free ? b : a);
    let tt = o.free, ready = rem.filter(s => s.it.ready <= tt);
    if (!ready.length) { tt = Math.min(...rem.map(s => s.it.ready)); ready = rem.filter(s => s.it.ready <= tt); }
    const temp = (o.temp != null && ready.some(s => s.it.temp === o.temp)) ? o.temp : Math.min(...ready.map(s => s.it.temp));
    if (o.temp == null) ovenEvents.push({ oven: o.i, kind: "preheat", start: tt - PRE, end: tt, temp });
    else if (temp !== o.temp) { const adj = temp > o.temp ? 10 : 20; ovenEvents.push({ oven: o.i, kind: "adjust", start: tt, end: tt + adj, from: o.temp, temp }); tt += adj; }
    const pick = ready.filter(s => s.it.temp === temp).sort((a, b) => a.it.ready - b.it.ready || items.indexOf(a.it) - items.indexOf(b.it)).slice(0, cap);
    const dur = Math.max(...pick.map(s => s.it.bake));
    const g = new Map(); pick.forEach(s => g.set(s.it, (g.get(s.it) || 0) + 1));
    rounds.push({ oven: o.i, start: tt, end: tt + dur, temp, groups: [...g].map(([it, n]) => ({ it, n })) });
    for (const s of pick) { rem.splice(rem.indexOf(s), 1); s.it.lastOut = Math.max(s.it.lastOut, tt + s.it.bake); if (s.it.firstIn == null) s.it.firstIn = tt; }
    o.free = tt + dur + 3; o.temp = temp;
  }
  let end = Math.max(T0, ...rounds.map(r => r.end));
  for (const it of items) { it.coolEnd = it.lastOut + it.cool; it.decoEnd = it.coolEnd + (it.deco || 0); end = Math.max(end, it.decoEnd); }
  const temps = [...new Set(items.map(i => i.temp))].sort((a, b) => a - b).map(tp => ({ temp: tp, items: items.filter(i => i.temp === tp) }));
  const sheets = items.reduce((a, i) => a + i.sheets, 0);
  return { items, before, today, rounds, ovenEvents, temps, T0, end, nOv, cap, PRE, sheets };
}

/* ---------- shopping ---------- */
const VOL = { tsp: 1, tbsp: 3, cup: 48, ml: 0.2029, l: 202.9 }, WT = { g: 1, kg: 1000, oz: 28.35, lb: 453.6 };
const keyOf = item => String(item || "").toLowerCase().replace(/[^a-z0-9% -]/g, " ").replace(/\s+/g, " ").trim().split(" ").map((w, i, a) => (i === a.length - 1 && w.length > 3 && /[^s]s$/.test(w)) ? w.slice(0, -1) : w).join(" ");
const DENS = [[/powdered|confectioner|icing sugar/, 120], [/brown sugar/, 213], [/sugar/, 200], [/bread flour/, 130], [/flour/, 125], [/cocoa/, 85], [/oat/, 90], [/chip|chocolate/, 170]];
function fmtVol(tsp) {
  if (tsp >= 12) { const c = tsp / 48; return `${frac(c)} ${c > 1.06 ? "cups" : "cup"}`; }
  if (tsp >= 3) { const tb = Math.floor(tsp / 3 + 1e-6), rest = tsp - tb * 3; return `${tb} tbsp${rest > 0.12 ? ` + ${frac(rest)} tsp` : ""}`; }
  return `${frac(tsp)} tsp`;
}
const fmtWt = g => g >= 450 ? `${(g / 453.6).toFixed(1).replace(/\.0$/, "")} lb` : `${Math.round(g)} g`;
const DENS_BUTTER = 227;
const densityOf = key => /butter/.test(key) && !/peanut|almond|cashew/.test(key) ? DENS_BUTTER : (DENS.find(([re]) => re.test(key)) || [])[1] || 0;
function addAmount(acc, qty, unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "stick") acc.vol += qty * 24; else if (VOL[u]) acc.vol += qty * VOL[u]; else if (WT[u]) acc.wt += qty * WT[u]; else if (u === "pinch") acc.pinch += qty; else acc.each += qty;
}
function amountText(a) {
  const parts = [];
  if (a.vol > 0.05) parts.push(fmtVol(a.vol));
  if (a.wt > 0.5) parts.push(fmtWt(a.wt) + (a.wt >= 113 && a.wt < 1000 ? ` (${Math.round(a.wt / 28.35)} oz)` : ""));
  if (a.each > 0.01) parts.push(frac(a.each));
  if (a.pinch > 0.01) parts.push(`${frac(a.pinch)} pinch`);
  return parts.join(" + ");
}
function buyHint(key, a) {
  if (/butter/.test(key) && a.vol) return `${frac(a.vol / 24)} sticks`;
  if (a.each % 1 > 0.01) return `buy ${Math.ceil(a.each)}`;
  const d = densityOf(key);
  if (d && a.vol >= 12) { const g = a.vol / 48 * d + a.wt; return g >= 225 ? `≈ ${(g / 453.6).toFixed(1)} lb` : `≈ ${Math.round(g)} g`; }
  return "";
}
/* Pantry entries match a shopping item by name; "flour" in the pantry also matches "all-purpose flour" on the list. */
function pantryFor(key) {
  const items = shopPantries().flatMap(p => p.items || []);
  const exact = items.filter(p => keyOf(p.item) === key && p.qty != null && p.qty !== "");
  const rows = exact.length ? exact : items.filter(p => { const k = keyOf(p.item); return k && p.qty != null && p.qty !== "" && (key.endsWith(" " + k) || k.endsWith(" " + key)); });
  if (!rows.length) return null;
  const acc = { vol: 0, wt: 0, each: 0, pinch: 0 };
  rows.forEach(p => addAmount(acc, num(p.qty), p.unit));
  return acc;
}
/* What's left to buy after the pantry. Converts between cups and weight where the density is known. */
function subtractPantry(key, need, have) {
  const d = densityOf(key), buy = { ...need };
  let comparable = false;
  if (d && (need.vol || need.wt) && (have.vol || have.wt)) {
    comparable = true;
    const needG = need.vol / 48 * d + need.wt, haveG = have.vol / 48 * d + have.wt, left = Math.max(0, needG - haveG);
    if (need.vol >= need.wt / d * 48) { buy.vol = left / d * 48; buy.wt = 0; } else { buy.wt = left; buy.vol = 0; }
  } else {
    if (need.vol && have.vol) { buy.vol = Math.max(0, need.vol - have.vol); comparable = true; }
    if (need.wt && have.wt) { buy.wt = Math.max(0, need.wt - have.wt); comparable = true; }
  }
  if (need.each && have.each) { buy.each = Math.max(0, need.each - have.each); comparable = true; }
  if (need.pinch && (have.pinch || have.vol || have.wt)) { buy.pinch = 0; comparable = true; }
  return { buy, comparable };
}
function shopping(bakerFilter) {
  const map = new Map();
  const sels = shopSelections(), multi = new Set(sels.map(x => x.bake)).size > 1;
  for (const { r, scale, baker, bake } of sels) {
    if (bakerFilter && baker !== bakerFilter) continue;
    for (const ing of (r.ingredients || [])) {
      const k = keyOf(ing.item); if (!k) continue;
      let e = map.get(k);
      if (!e) { e = { key: k, item: ing.item, category: CATS.includes(ing.category) ? ing.category : "Other", need: { vol: 0, wt: 0, each: 0, pinch: 0 }, asNeeded: false, from: new Set() }; map.set(k, e); }
      e.from.add(multi ? `${r.name} (${bake})` : r.name);
      if (ing.qty == null || ing.qty === "") { e.asNeeded = true; continue; }
      addAmount(e.need, num(ing.qty) * scale, ing.unit);
    }
  }
  const list = [...map.values()].map(e => {
    const amount = amountText(e.need) || "as needed";
    const have = pantryFor(e.key);
    let buy = e.need, status = "buy", haveText = "", comparable = false;
    if (have) {
      ({ buy, comparable } = subtractPantry(e.key, e.need, have));
      haveText = amountText(have);
      if (!comparable) status = "check";
      else status = amountText(buy) ? "partial" : "covered";
    }
    const buyText = amountText(buy) || (e.asNeeded && !have ? "as needed" : "");
    return { ...e, amount, have: !!have, haveText, status, buyText, hint: status === "covered" ? "" : buyHint(e.key, buy), from: [...e.from] };
  });
  return CATS.map(c => ({ cat: c, items: list.filter(e => e.category === c && e.status !== "covered").sort((a, b) => a.item.localeCompare(b.item)) }))
    .filter(g => g.items.length)
    .concat([{ cat: "Already in the pantry", covered: true, items: list.filter(e => e.status === "covered").sort((a, b) => a.item.localeCompare(b.item)) }].filter(g => g.items.length));
}

/* ---------- render ---------- */
function render() {
  const main = $("#main");
  document.body.classList.toggle("signed-out", S.signedIn === false);
  if (S.signedIn === false) { main.innerHTML = viewLogin(); restoreLoginFocus(); return; }
  const sel = selectedList();
  for (const t of TABS) $(`#tab-${t}`).setAttribute("aria-selected", String(S.tab === t));
  $("#ct-recipes").textContent = S.loaded ? S.recipes.length : "";
  $("#ct-plan").textContent = sel.length || "";
  const shopN = shopSelections().length ? shopping().filter(g => !g.covered).reduce((a, g) => a + g.items.length, 0) : 0;
  $("#ct-shopping").textContent = shopN || "";
  const keep = preserve(main);
  const view = { recipes: viewRecipes, plan: viewPlan, shopping: viewShopping, settings: viewSettings }[S.tab] || viewRecipes;
  main.innerHTML = notices() + (S.loaded ? view() : `<div class="empty"><div class="spin"></div><p class="muted">Opening your recipe box…</p></div>`);
  restore(keep);
  if (S.modal && S.modal.type === "detail") renderModal();
}
function preserve(root) { const a = document.activeElement; return { id: a && root.contains(a) ? a.id : null, scroll: window.scrollY }; }
function restore(k) { if (k.id) { const el = document.getElementById(k.id); if (el) el.focus({ preventScroll: true }); } }
function notices() {
  return S.loadError ? `<div class="banner warn">${esc(S.loadError)} <button class="btn sm" data-act="reload">Try again</button></div>` : "";
}

/* ---------- sign in ---------- */
function viewLogin() {
  const L = S.login;
  const msg = L.msg ? `<div class="status ${L.err ? "err" : ""}">${esc(L.msg)}</div>` : "";
  if (L.step === "code") return `<section class="login panel"><h1>Check your email</h1><p class="muted">Enter the 6-digit code sent to <b>${esc(L.email)}</b>.</p>
    <form data-form="code"><label class="field"><span class="label">Code</span><input id="login-code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>${msg}
    <button class="btn primary" ${L.busy ? "disabled" : ""}>Sign in</button></form>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="login-resend" ${L.busy ? "disabled" : ""}>Send a new code</button><button class="btn ghost sm" data-act="login-back">Use a different email</button></div></section>`;
  return `<section class="login panel"><h1>Sign in to Cookie Repo</h1><p class="muted">Enter your email. If it's on the household list, we'll send you a sign-in code.</p>
    <form data-form="email"><label class="field"><span class="label">Email</span><input id="login-email" type="email" autocomplete="email" required value="${esc(L.email)}"></label>${msg}
    <button class="btn primary" ${L.busy ? "disabled" : ""}>Email me a code</button></form></section>`;
}
function restoreLoginFocus() { const el = $("#login-code") || $("#login-email"); if (el && document.activeElement?.tagName !== "INPUT") el.focus(); }
async function requestCode(email) {
  const L = S.login; L.busy = true; L.err = false; L.msg = ""; render();
  try { const d = await api("POST", "/api/auth/request", { email }); L.email = email; L.step = "code"; L.msg = d.message; }
  catch (e) { L.err = true; L.msg = e.message; }
  L.busy = false; render();
}
async function submitCode(code) {
  const L = S.login; L.busy = true; L.err = false; L.msg = ""; render();
  try { await api("POST", "/api/auth/verify", { email: L.email, code }); S.login = { step: "email", email: "", busy: false, msg: "", err: false }; S.loaded = false; await loadState(); }
  catch (e) { L.busy = false; L.err = true; L.msg = e.message; render(); }
}

/* ---------- settings ---------- */
function viewSettings() {
  const rows = S.people.map(p => `<div class="person"><label class="field"><span class="label">Name</span><input id="pn-${esc(p.email)}" data-change="person-name" data-email="${esc(p.email)}" value="${esc(p.name)}" placeholder="Name"></label>
    <span class="em">${esc(p.email)}${p.email === S.me.email ? " · you" : ""}</span>
    <label class="field"><span class="label">Pantry</span><select id="pf-${esc(p.email)}" data-change="person-pantry" data-email="${esc(p.email)}">${S.pantries.map(x => `<option value="${esc(x.id)}" ${x.id === (p.pantry || S.pantries[0]?.id) ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
    ${p.email === S.me.email ? "<span></span>" : `<button class="btn ghost sm danger" data-act="person-del" data-email="${esc(p.email)}" style="border-color:transparent">Remove</button>`}</div>`).join("");
  const confirm = S.confirmPerson ? `<div class="confirm"><span>Remove ${esc(personName(S.confirmPerson))}? They'll be signed out and can't sign in again unless re-added.</span><button class="btn danger solid sm" data-act="person-del-yes">Remove</button><button class="btn sm" data-act="person-del-no">Keep</button></div>` : "";
  return `<div class="page-head"><div><h1>Settings</h1><p class="muted">Signed in as ${esc(S.me.name || S.me.email)}</p></div><button class="btn" data-act="logout">Sign out</button></div>
    <section class="panel"><div class="panel-head"><h2>Who can sign in</h2><span class="muted">${S.people.length} ${S.people.length === 1 ? "person" : "people"}</span></div>
      <p class="muted" style="font-size:.9rem">Anyone on this list can sign in with an emailed code. Names show up as recipe owners and bakers. Each person is linked to a pantry, and new bakes they start use it. People who share a kitchen can share a pantry. Add and rename pantries on the Shopping tab.</p>
      <div>${rows}</div>${confirm}
      <form class="add-person" data-form="person"><input id="np-name" class="inp" placeholder="Name" aria-label="Name" maxlength="60"><input id="np-email" class="inp" type="email" placeholder="email@example.com" aria-label="Email" required><button class="btn primary">Add person</button></form>
    </section>`;
}
async function peopleCall(method, url, body) {
  try { const d = await api(method, url, body); S.people = d.people.map(({ email, name, pantry }) => ({ email, name, pantry: pantry || "" })); S.me = S.people.find(p => p.email === S.me.email) || S.me; render(); return true; }
  catch (e) { toast(e.message); return false; }
}

function recipeChips(r) {
  const c = [];
  if (r.ovenTempF) c.push(`<span class="chip temp">${esc(r.ovenTempF)}°F</span>`);
  if (r.bakeMinutes) c.push(`<span class="chip">${esc(r.bakeMinutes)} min bake</span>`);
  if (num(r.chillMinutes)) c.push(`<span class="chip chill">chill ${esc(fmtDur(num(r.chillMinutes)))}</span>`);
  if (r.yieldCount) c.push(`<span class="chip">makes ${esc(r.yieldCount)}</span>`);
  return c.join("");
}
function viewRecipes() {
  const head = `<div class="page-head"><div><h1>Recipe box</h1><p class="muted">Tap “Bake” on the cookies you're making. The plan and shopping list build themselves.</p></div><button class="btn primary" data-act="import">+ Add recipe</button></div>`;
  if (!S.loaded) return head + `<div class="empty"><div class="spin"></div><p class="muted">Opening your recipe box…</p></div>`;
  if (!S.recipes.length) return head + `<div class="empty"><h2>No recipes yet</h2><p class="muted">Paste a link, snap a photo of a recipe card, or paste the text. Claude reads the ingredients, times and oven temperature, and you check them before saving.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn primary" data-act="import">Add your first recipe</button><button class="btn" data-act="examples">Load 3 example recipes</button></div></div>`;
  const owners = [...new Set(S.recipes.map(r => r.owner).filter(Boolean))];
  const bar = `<div class="search-bar"><input id="recipe-q" type="search" class="inp" placeholder="Search names, ingredients, notes…" aria-label="Search recipes" value="${esc(S.q || "")}" autocomplete="off">
    ${owners.length > 1 ? `<label class="who">Owner ${personSelect("recipe-owner", S.ownerFilter || "", `data-change="owner-filter"`, "Filter by owner", "Anyone")}</label>` : ""}</div>`;
  return head + bar + `<div id="recipe-results">${recipeResults()}</div>`;
}
/* Every word has to appear somewhere in the recipe: its name, ingredients, notes, owner, source, steps or tips. */
const fold = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function matchRecipe(r, words) {
  if (!words.length) return { ok: true };
  const fields = [
    ["name", r.name], ["ingredient", (r.ingredients || []).map(g => g.item).join(" · ")], ["note", (r.notes || []).map(n => n.text).join(" · ")],
    ["owner", personName(r.owner)], ["source", [r.source, r.link && hostOf(r.link)].join(" ")], ["method", [(r.steps || []).join(" "), r.decorating, r.makeAheadTip].join(" ")],
  ].map(([k, v]) => [k, String(v || ""), fold(v)]);
  const all = fields.map(f => f[2]).join(" ");
  if (!words.every(w => all.includes(w))) return { ok: false };
  const rest = words.filter(w => !fields[0][2].includes(w)); // words the name doesn't explain
  if (!rest.length) return { ok: true };
  // Prefer a field holding all of them ("sea salt" in a note beats "salt" in the ingredients), and the phrase itself.
  const phrase = rest.join(" ");
  const pick = fields.slice(1).find(f => f[2].includes(phrase)) || fields.slice(1).find(f => rest.every(w => f[2].includes(w))) || fields.slice(1).find(f => rest.some(w => f[2].includes(w)));
  if (!pick) return { ok: true };
  const [k, raw] = pick, hit = t => rest.some(w => fold(t).includes(w));
  if (k === "ingredient") return { ok: true, why: `Has ${(r.ingredients || []).map(g => g.item).filter(hit).slice(0, 3).join(", ")}` };
  if (k === "note") { const n = (r.notes || []).find(n => fold(n.text).includes(phrase)) || (r.notes || []).find(n => hit(n.text)); return { ok: true, why: `Note: ${n.text.length > 70 ? n.text.slice(0, 70) + "…" : n.text}` }; }
  return { ok: true, why: k === "owner" ? `Owner: ${raw}` : k === "source" ? `From ${raw.trim()}` : "Mentioned in the method" };
  return { ok: true };
}
function recipeResults() {
  const words = fold(S.q).split(/\s+/).filter(Boolean);
  const hits = S.recipes.filter(r => !S.ownerFilter || r.owner === S.ownerFilter).map(r => ({ r, m: matchRecipe(r, words) })).filter(x => x.m.ok);
  if (!hits.length) return `<div class="empty"><h2>No recipes match</h2><p class="muted">${S.q ? `Nothing has “${esc(S.q)}”${S.ownerFilter ? ` for ${esc(personName(S.ownerFilter))}` : ""}. Try fewer words, or an ingredient.` : "No recipes for that owner yet."}</p><button class="btn" data-act="search-clear">Clear search</button></div>`;
  const count = words.length || S.ownerFilter ? `<p class="muted" style="font-size:.88rem;margin-bottom:10px">${hits.length} of ${S.recipes.length} recipes</p>` : "";
  const cards = hits.map(({ r, m }) => {
    const on = !!S.plan.selections?.[r.id], nN = (r.notes || []).length;
    return `<article class="card ${on ? "on" : ""}" data-act="open" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}">
      <div class="card-top"><h3>${esc(r.name || "Untitled")}</h3>${r.example ? `<span class="chip ex">Example</span>` : ""}</div>
      <div class="chips">${recipeChips(r)}</div>${m.why ? `<p class="why">${esc(m.why)}</p>` : ""}
      <div class="card-foot"><span class="muted">${r.owner ? `${esc(personName(r.owner))} · ` : ""}${nN ?`${nN} note${nN > 1 ? "s" : ""}` : (r.ingredients || []).length + " ingredients"}${on ? ` · ${scaleLabel(scaleOf(r.id))}` : ""}</span>
      <button class="toggle" data-act="toggle" data-id="${esc(r.id)}" aria-pressed="${on}">${on ? "✓ Baking" : "+ Bake"}</button></div>
    </article>`;
  }).join("");
  return count + `<div class="grid">${cards}</div>`;
}
function viewPlan() {
  const P = S.plan, sel = selectedList(), sc = schedule();
  const fam = family(), mainId = fam[0]?.id || P.id, isMain = mainId === P.id;
  const tabsRow = `<div class="bake-tabs" role="group" aria-label="Bakes in this event">${fam.length > 1 ? fam.map(b => `<button class="bake-tab" data-act="${b.id === P.id ? "noop" : "bake-open"}" data-id="${esc(b.id)}" aria-pressed="${b.id === P.id}"><b>${esc(b.name)}</b><span>${b.id === mainId ? "Main bake" : "Prebake"} · ${esc(fmtDay(parseDate(b.bakeDate)))}</span></button>`).join("") : ""}<button class="btn sm" data-act="prebake-new" data-id="${esc(mainId)}">+ Add prebake</button></div>`;
  const hasKids = S.bakes.some(b => b.partOf === P.id);
  const mains = allBakes().filter(b => b.id !== P.id && !(b.partOf && S.bakes.some(x => x.id === b.partOf))).sort(byDate).reverse();
  const partOfField = `<label class="field"><span class="label">Part of</span><select id="p-partof" data-change="plan" data-k="partOf" ${hasKids ? "disabled title=\"This bake has prebakes, so it stays a main bake\"" : ""}><option value="">Nothing (a main bake)</option>${mains.map(b => `<option value="${esc(b.id)}" ${P.partOf === b.id ? "selected" : ""}>Prebake for ${esc(b.name)}</option>`).join("")}</select></label>`;
  const settings = `<section class="panel"><div class="settings">
    <label class="field bake-name"><span class="label">Name</span><input id="p-name" class="inp" data-change="plan" data-k="name" value="${esc(P.name)}" maxlength="80" placeholder="${esc(bakeNameFor(P.bakeDate))}"></label>
    ${partOfField}
    <label class="field"><span class="label">Bake day</span><input type="date" id="p-date" data-change="plan" data-k="bakeDate" value="${esc(P.bakeDate)}"></label>
    <label class="field"><span class="label">Start at</span><input type="time" id="p-start" data-change="plan" data-k="start" value="${esc(P.start)}"></label>
    <label class="field"><span class="label">Ovens</span><select id="p-ovens" data-change="plan" data-k="ovens">${[1, 2, 3].map(n => `<option ${num(P.ovens) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="field"><span class="label">Sheets per oven</span><select id="p-sheets" data-change="plan" data-k="sheetsPerOven">${[1, 2, 3, 4].map(n => `<option ${num(P.sheetsPerOven) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="p-ahead" data-change="plan" data-k="aheadAll" ${P.aheadAll ? "checked" : ""}>Mix doughs the night before when they keep</label>
  </div></section>`;
  const others = S.bakes.length - 1;
  const head = `<div class="page-head"><div><h1>${esc(P.name || "Bake plan")}</h1><p class="muted">${!isMain ? `Prebake for ${esc(fam[0].name)} · ` : ""}${esc(fmtDay(parseDate(P.bakeDate)))}${sel.length ? ` · ${sel.length} cookie${sel.length > 1 ? "s" : ""}` : ""}</p></div>
    <button class="btn" data-act="bakes">${others > 0 ? `All bakes (${S.bakes.length})` : "All bakes"}</button><button class="btn primary" data-act="bake-new">New bake</button></div>`;
  const past = P.bakeDate < isoDate(new Date()) ? `<div class="banner">This bake was on ${esc(fmtDay(parseDate(P.bakeDate)))}. Changes here update that record. Planning the next one? <button class="btn sm" data-act="bake-copy" data-id="${esc(P.id)}">Start a new bake from this one</button></div>` : "";
  const gone = Object.entries(P.selections || {}).filter(([id]) => !getR(id));
  const goneNote = gone.length ? `<p class="muted" style="font-size:.88rem">Left off this plan: ${gone.map(([, v]) => esc(v?.name || "a recipe")).join(", ")} (no longer in the recipe box).</p>` : "";
  const notes = `<section class="panel"><div class="panel-head"><h2>Notes on this bake</h2></div><textarea id="p-notes" class="inp" rows="3" data-change="plan" data-k="notes" maxlength="5000" placeholder="How it went, what ran out, what to change next time">${esc(P.notes || "")}</textarea></section>`;
  if (!sel.length) return head + tabsRow + past + settings + goneNote + `<div class="empty"><h2>Nothing on the baking list</h2><p class="muted">Pick recipes in the recipe box with “+ Bake”. You'll get a make-ahead list, which cookies can share the oven, and a timed bake-day schedule.</p><button class="btn primary" data-act="tab" data-tab="recipes">Choose recipes</button></div>` + notes;
  const picked = `<section class="panel"><div class="panel-head"><h2>Baking</h2><span class="muted">${sc.sheets} sheet${sc.sheets > 1 ? "s" : ""} · ${sc.items.reduce((a, i) => a + i.count, 0)} cookies</span></div><div class="sel-list">${sc.items.map(it => `
    <div class="sel-row"><span class="dot" style="background:var(--c${it.color})"></span>
      <div style="min-width:0"><div class="nm"><a href="#" data-act="open" data-id="${esc(it.r.id)}" style="color:inherit">${esc(it.r.name)}</a></div><div class="sub">${it.count} cookies · ${it.sheets} sheet${it.sheets > 1 ? "s" : ""} of ${it.per} · ${it.temp}°F</div></div>
      <label class="who">Baker ${personSelect(`baker-${it.r.id}`, it.baker, `class="inp" data-change="baker" data-id="${esc(it.r.id)}"`, `Baker for ${it.r.name}`, "Unassigned")}</label>
      ${scaleControl(it.r)}
      <button class="btn ghost sm" data-act="toggle" data-id="${esc(it.r.id)}" aria-label="Remove ${esc(it.r.name)}">Remove</button></div>`).join("")}</div>
    ${goneNote}<div class="summary"><span>Done by <b>${fmtT(sc.end)}</b></span><span>Oven rounds <b>${sc.rounds.length}</b></span><span>Sheet pans <b>${Math.min(sc.sheets, sc.cap * sc.nOv * 2)}</b></span></div></section>`;

  // make ahead
  const bd = parseDate(P.bakeDate), eve = new Date(bd); eve.setDate(bd.getDate() - 1);
  const optional = sc.items.filter(it => !it.ahead && (it.keeps >= 1 || it.freezable));
  let ahead = `<section class="panel"><div class="panel-head"><h2>Make ahead</h2><span class="muted">${esc(fmtDay(eve))}</span></div>`;
  if (sc.before.length) {
    ahead += sc.before.map(it => `<div class="task"><span class="when">Evening</span><p><b>Mix ${esc(it.r.name)} dough</b> (${fmtDur(it.prep)}), wrap and refrigerate.</p><span class="sub">${it.ahead === "required" ? `Needs ${fmtDur(it.chill)} of chilling, so it can't be done the same morning.` : `Dough keeps ${it.keeps} day${it.keeps > 1 ? "s" : ""}; mixing tonight frees up the morning.`}${it.r.makeAheadTip ? " " + esc(it.r.makeAheadTip) : ""}</span></div>`).join("");
    ahead += `<p class="muted" style="font-size:.85rem">About ${fmtDur(sc.before.reduce((a, i) => a + i.prep, 0))} of mixing tonight.</p>`;
  } else ahead += `<p class="muted">Nothing has to happen the day before. Every dough can be mixed on bake day.</p>`;
  if (optional.length) ahead += `<div><span class="label">Could also be made early</span>${optional.map(it => `<div class="task"><span class="when">${it.keeps >= 1 ? `≤ ${it.keeps} day${it.keeps > 1 ? "s" : ""}` : "freezer"}</span><p>${esc(it.r.name)}${it.freezable ? " · dough freezes well" : ""}</p>${it.r.makeAheadTip ? `<span class="sub">${esc(it.r.makeAheadTip)}</span>` : ""}</div>`).join("")}</div>`;
  ahead += `</section>`;

  // oven sharing
  let share = `<section class="panel"><div class="panel-head"><h2>Oven sharing</h2></div>`;
  share += sc.temps.map(g => {
    const names = g.items.map(i => esc(i.r.name));
    const bakes = g.items.map(i => i.bake), spread = Math.max(...bakes) - Math.min(...bakes);
    const msg = g.items.length > 1 ? `<b>Bake together:</b> ${names.join(" + ")}${spread >= 3 ? `<span class="sub" style="display:block;color:var(--muted);font-size:.85rem">Bake times differ by ${spread} min, so pull each sheet on its own timer.</span>` : ""}` : `${names[0]} bakes on its own at this temperature.`;
    return `<div class="tempgroup"><span class="deg">${g.temp}°F</span><p>${msg}</p></div>`;
  }).join("");
  if (sc.temps.length > 1) share += `<p class="muted" style="font-size:.85rem">Different temperatures bake one after another, lowest first, since an oven heats up faster than it cools down.${sc.nOv > 1 ? " With more than one oven, they can run at the same time." : ""}</p>`;
  share += `</section>`;

  // reminders
  const rem = sel.filter(x => (x.r.notes || []).length);
  const reminders = rem.length ? `<section class="panel"><div class="panel-head"><h2>Notes from last time</h2></div><div class="notes">${rem.map(x => [...x.r.notes].slice(-2).reverse().map(n => `<div class="note"><span class="d">${esc(x.r.name)} · ${esc(fmtNoteDate(n.at))}${n.by ? ` · ${esc(personName(n.by))}` : ""}</span><p>${esc(n.text)}</p></div>`).join("")).join("")}</div></section>` : "";

  return head + tabsRow + past + settings + picked + `<div class="two">${ahead}${share}</div>` + reminders + viewTimeline(sc) + notes;
}
function viewTimeline(sc) {
  const t0 = sc.T0, t1 = Math.max(sc.end, t0 + 60), span = t1 - t0;
  const pos = (a, b) => `left:${((a - t0) / span * 100).toFixed(2)}%;width:${Math.max(0.6, (b - a) / span * 100).toFixed(2)}%`;
  const bar = (cls, a, b, label, style = "") => `<div class="bar ${cls}" style="${pos(a, b)};${style}" title="${esc(label)} · ${fmtT(a)}–${fmtT(b)}">${esc(label)}</div>`;
  let ticks = ""; for (let m = Math.ceil(t0 / 60) * 60; m <= t1; m += (span > 600 ? 120 : 60)) ticks += `<span style="left:${((m - t0) / span * 100).toFixed(2)}%">${fmtT(m).replace(":00", "")}</span>`;
  let rows = `<div></div><div class="ticks">${ticks}</div>`;
  for (let o = 0; o < sc.nOv; o++) {
    let b = sc.ovenEvents.filter(e => e.oven === o).map(e => bar("heat", e.start, e.end, e.kind === "preheat" ? `Preheat ${e.temp}°` : `→ ${e.temp}°`)).join("");
    b += sc.rounds.filter(r => r.oven === o).map(r => bar("", r.start, r.end, r.groups.map(g => g.it.r.name).join(" + "), `background:var(--c${r.groups[0].it.color})`)).join("");
    rows += `<div class="lane-label">Oven ${sc.nOv > 1 ? o + 1 : ""}</div><div class="track">${b}</div>`;
  }
  for (const it of sc.items) {
    let b = "";
    if (it.mixStart != null) b += bar("mix", it.mixStart, it.mixEnd, "Mix");
    if (it.mixStart != null && it.chill) b += bar("chill", it.mixEnd, it.ready, "Chill");
    if (it.firstIn != null) b += bar("", it.firstIn, it.lastOut, "Baking", `background:var(--c${it.color})`);
    b += bar("cool", it.lastOut, it.coolEnd, "Cool");
    if (it.deco) b += bar("deco", it.coolEnd, it.decoEnd, "Decorate");
    rows += `<div class="lane-label" title="${esc(it.r.name)}"><span class="dot" style="background:var(--c${it.color})"></span>${esc(it.r.name)}</div><div class="track">${b}</div>`;
  }
  // agenda
  const ev = [];
  const tag = its => { const names = [...new Set(its.map(i => i.baker))]; return { bakers: names, html: names.filter(Boolean).map(b => `<span class="baker">${esc(personName(b))}</span>`).join("") }; };
  for (const it of sc.today) ev.push({ t: it.mixStart, its: [it], txt: `<b>Mix ${esc(it.r.name)} dough</b>${it.scale !== 1 ? ` (${scaleLabel(it.scale)})` : ""}`, sub: it.chill ? `${fmtDur(it.prep)}, then chill until ${fmtT(it.ready)}` : `${fmtDur(it.prep)}` });
  if (sc.before.length) ev.push({ t: sc.T0, its: sc.before, txt: `Take the make-ahead dough out of the fridge`, sub: sc.before.map(i => i.r.name).join(", ") + ". Let stiff dough sit 10 min before scooping or rolling." });
  for (const e of sc.ovenEvents) {
    const its = sc.rounds.filter(r => r.oven === e.oven && r.start >= e.end - 1).slice(0, 1).flatMap(r => r.groups.map(g => g.it));
    ev.push({ t: e.start, its, txt: e.kind === "preheat" ? `Preheat ${sc.nOv > 1 ? `oven ${e.oven + 1}` : "the oven"} to ${e.temp}°F` : `${e.temp > e.from ? "Turn up" : "Turn down"} ${sc.nOv > 1 ? `oven ${e.oven + 1}` : "the oven"} to ${e.temp}°F`, sub: e.kind === "adjust" ? `Give it ${fmtDur(e.end - e.start)} to settle.` : "" });
  }
  for (const r of sc.rounds) {
    const bakes = r.groups.map(g => g.it.bake), mixed = Math.max(...bakes) !== Math.min(...bakes);
    ev.push({ t: r.start, its: r.groups.map(g => g.it), txt: `${r.groups.map(g => `${g.n} sheet${g.n > 1 ? "s" : ""} ${esc(g.it.r.name)}`).join(" + ")} in${sc.nOv > 1 ? ` oven ${r.oven + 1}` : ""}`, sub: mixed ? r.groups.map(g => `${g.it.r.name}: ${g.it.bake} min`).join(" · ") : `${r.temp}°F · ${r.end - r.start} min, out at ${fmtT(r.end)}` });
  }
  for (const it of sc.items) if (it.deco) ev.push({ t: it.coolEnd, its: [it], txt: `Decorate ${esc(it.r.name)}`, sub: `${fmtDur(it.deco)}${it.r.decorating ? ` · ${it.r.decorating}` : ""}` });
  ev.push({ t: sc.end, its: [], txt: `<b>Everything's done</b>`, sub: "" });
  ev.sort((a, b) => a.t - b.t);
  const f = S.bakerFilter;
  const agenda = ev.map(e => { const t = tag(e.its); const dim = f && e.its.length && !t.bakers.includes(f); return `<div class="task ${dim ? "dim" : ""}"><span class="when">${fmtT(e.t)}</span><p>${e.txt}${t.html}</p>${e.sub ? `<span class="sub">${esc(e.sub)}</span>` : ""}</div>`; }).join("");
  const bakers = [...new Set(sc.items.map(i => i.baker).filter(Boolean))];
  const filter = bakers.length > 1 || (bakers.length === 1 && sc.items.some(i => !i.baker)) ? `<label class="who">Highlight ${personSelect("baker-filter", f, `data-change="baker-filter"`, "Highlight one baker's tasks", "Everyone")}</label>` : "";
  return `<section class="panel"><div class="panel-head"><h2>Bake day</h2><span class="muted">${esc(fmtDay(parseDate(S.plan.bakeDate)))} · ${fmtT(sc.T0)} – ${fmtT(sc.end)}</span>${filter}</div>
    <div class="chart-scroll"><div class="lanes">${rows}</div></div>
    <div class="legend"><span><i style="background:var(--ink)"></i>Mixing</span><span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Chilling</span><span><i style="background:var(--sugar-soft)"></i>Oven heating</span><span><i style="background:var(--c1)"></i>Baking</span><span><i style="background:var(--line)"></i>Cooling</span></div>
    <div>${agenda}</div></section>`;
}
function viewShopping() {
  const sel = shopSelections(), f = S.shopFilter, P = S.plan;
  const fam = family(), ids = shopBakeIds(), all = allBakes(), scope = P.shopScope || "this";
  const names = ids.map(id => all.find(b => b.id === id)?.name).filter(Boolean);
  const scopeBar = `<div class="seg shop-scope" role="group" aria-label="Shopping list for">
      <button data-act="shop-scope" data-scope="this" aria-pressed="${scope === "this"}">This bake</button>
      ${fam.length > 1 && curPantry() && fam.filter(b => pantryIdOf(b) === pantryIdOf(P)).length > 1 && fam.some(b => pantryIdOf(b) !== pantryIdOf(P)) ? `<button data-act="shop-scope" data-scope="pantry" aria-pressed="${scope === "pantry"}">Everything using ${esc(curPantry().name)}</button>` : ""}
      ${fam.length > 1 ? `<button data-act="shop-scope" data-scope="event" aria-pressed="${scope === "event"}">${esc(fam[0].name)} + ${fam.length - 1} prebake${fam.length > 2 ? "s" : ""}</button>` : ""}
      <button data-act="shop-scope" data-scope="custom" aria-pressed="${scope === "custom"}">Choose bakes</button></div>
    ${scope === "custom" ? `<div class="panel shop-pick">${all.slice().sort(byDate).reverse().map(b => `<label class="check"><input type="checkbox" data-change="shop-bake" data-id="${esc(b.id)}" ${ids.includes(b.id) ? "checked" : ""}>${esc(b.name)} <span class="muted">· ${esc(fmtDay(parseDate(b.bakeDate)))}</span></label>`).join("")}</div>` : ""}`;
  const bakers = [...new Set(sel.map(x => x.baker).filter(Boolean))];
  const shown = f ? sel.filter(x => x.baker === f) : sel;
  const filter = bakers.length > 1 ? `<label class="who">For ${personSelect("shop-filter", f, `data-change="shop-filter"`, "Show one baker's shopping", "Everyone")}</label>` : "";
  const head = `<div class="page-head"><div><h1>Shopping list</h1><p class="muted">${names.length > 1 ? `Combining ${names.map(esc).join(", ")}` : esc(S.plan.name || "This bake")} · ${names.length > 1 ? `${shown.length} cookie batch${shown.length === 1 ? "" : "es"}` : shown.length ? `For ${shown.map(x => `${esc(x.r.name)}${x.scale !== 1 ? ` (${scaleLabel(x.scale)})` : ""}`).join(", ")}` : "Built from everything on the baking list"}</p></div>${filter}${sel.length ? `<button class="btn" data-act="copy-list">Copy list</button><button class="btn ghost" data-act="clear-have">Uncheck all</button>` : ""}</div>`;
  let list;
  if (!sel.length) list = `<div class="empty"><h2>No recipes picked yet</h2><p class="muted">Add cookies to the bake plan and their ingredients are combined here, scaled to your batch sizes, minus what's already in your pantry.</p><button class="btn primary" data-act="tab" data-tab="recipes">Choose recipes</button></div>`;
  else {
    const groups = shopping(f), have = S.plan.have || {};
    const toBuy = groups.filter(g => !g.covered), total = toBuy.reduce((a, g) => a + g.items.length, 0), got = toBuy.reduce((a, g) => a + g.items.filter(e => have[e.key]).length, 0);
    list = `<section class="panel"><div class="panel-head"><h2>${total} to buy</h2><span class="muted">${got} in the cart</span></div>${groups.map(g => `<div class="shop-cat"><h3>${esc(g.cat)}</h3>${g.items.map(e => {
      const id = "h-" + e.key.replace(/[^a-z0-9]/g, "-");
      const fromTxt = esc(e.from.join(" · "));
      const pantryTxt = e.status === "partial" ? `Need ${esc(e.amount)} · pantry has ${esc(e.haveText)}` : e.status === "check" ? `Pantry has ${esc(e.haveText)}; check whether that's enough` : e.status === "covered" ? `Need ${esc(e.amount)} · pantry has ${esc(e.haveText)}` : "";
      const amt = e.status === "covered" ? "✓ covered" : (e.status === "partial" ? e.buyText : e.amount);
      return `<label class="shop-row ${have[e.key] || e.status === "covered" ? "have" : ""}" for="${esc(id)}"><input type="checkbox" id="${esc(id)}" data-change="have" data-key="${esc(e.key)}" ${have[e.key] || e.status === "covered" ? "checked" : ""} ${e.status === "covered" ? "disabled" : ""}><div style="min-width:0"><div class="it">${esc(e.item)}</div><div class="from">${fromTxt}</div>${pantryTxt ? `<div class="from" style="color:var(--good)">${pantryTxt}</div>` : ""}</div><div class="amt">${esc(amt)}${e.hint ? `<span class="hint">${esc(e.hint)}</span>` : ""}</div></label>`;
    }).join("")}</div>`).join("")}</section>`;
  }
  return head + scopeBar + `<div class="two" style="align-items:start">${list}${viewPantry()}</div>`;
}
function viewPantry() {
  const pan = curPantry(), pid = pantryIdOf(S.plan), used = shopPantries();
  const picker = `<label class="field"><span class="label">Pantry for ${esc(S.plan.name || "this bake")}</span><select id="pantry-pick" data-change="plan" data-k="pantryId">${S.pantries.map(p => `<option value="${esc(p.id)}" ${p.id === pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}<option value="" ${pid ? "" : "selected"}>None: don't subtract anything</option></select></label>`;
  const manage = `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm ghost" data-act="pantry-new">+ New pantry</button>${pan ? `<button class="btn sm ghost danger" data-act="pantry-remove" style="border-color:transparent">Delete this pantry</button>` : ""}</div>`;
  const combined = used.length > 1 ? `<p class="banner" style="font-size:.85rem">This list subtracts ${used.map(p => `<b>${esc(p.name)}</b>`).join(" and ")}, since its bakes use different pantries.</p>` : "";
  const confirmRemove = S.confirmPantryRemove && pan ? `<div class="confirm"><span>Delete ${esc(pan.name)} and its ${pan.items.length} item${pan.items.length === 1 ? "" : "s"}? Bakes using it will have no pantry.</span><button class="btn danger solid sm" data-act="pantry-remove-yes">Delete</button><button class="btn sm" data-act="pantry-remove-no">Keep</button></div>` : "";
  if (!pan) return `<section class="panel"><div class="panel-head"><h2>Pantry</h2></div>${picker}${combined}<p class="muted" style="font-size:.88rem">${S.pantries.length ? "This bake doesn't use a pantry, so nothing is subtracted for it." : "No pantries yet. Make one for each kitchen."}</p>${manage}</section>`;
  const rows = pan.items.map((p, i) => `<div class="ing-row" style="grid-template-columns:64px 76px minmax(0,1fr) 30px">
      <input id="pt-${i}-qty" data-pantry="${i}" data-k="qty" value="${esc(p.qty == null ? "" : String(p.qty))}" placeholder="5" aria-label="Amount">
      <select id="pt-${i}-unit" data-pantry="${i}" data-k="unit" aria-label="Unit">${UNITS.map(u => `<option value="${u}" ${u === p.unit ? "selected" : ""}>${u || "—"}</option>`).join("")}</select>
      <input id="pt-${i}-item" data-pantry="${i}" data-k="item" value="${esc(p.item)}" placeholder="all-purpose flour" aria-label="Item">
      <button class="x" data-act="pantry-del" data-i="${i}" aria-label="Remove ${esc(p.item || "item")}" style="font-size:1.1rem">×</button></div>`).join("");
  return `<section class="panel"><div class="panel-head"><h2>${esc(pan.name)}</h2><span class="muted">${pan.items.length} item${pan.items.length === 1 ? "" : "s"}</span></div>
    ${picker}
    <label class="field"><span class="label">Pantry name</span><input id="pantry-name" class="inp" data-change="pantry-name" value="${esc(pan.name)}" maxlength="60" placeholder="e.g. Sapp's pantry"></label>
    ${combined}
    <p class="muted" style="font-size:.88rem">What this kitchen already has. It's subtracted from the shopping list, converting cups and pounds for flour, sugar and butter.</p>
    <div class="ing-edit">${rows || `<p class="muted" style="font-size:.9rem">Nothing in this pantry yet.</p>`}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="pantry-add">+ Add item</button>${pan.items.length ? `<button class="btn sm ghost" data-act="pantry-clear">Clear pantry</button>` : ""}</div></div>
    ${S.confirmPantryClear ? `<div class="confirm"><span>Remove all ${pan.items.length} items from ${esc(pan.name)}?</span><button class="btn danger solid sm" data-act="pantry-clear-yes">Clear</button><button class="btn sm" data-act="pantry-clear-no">Keep</button></div>` : ""}
    <label class="field"><span class="label">Paste a list, one item per line</span><textarea id="pantry-paste" rows="4" class="inp" placeholder="5 lb all-purpose flour&#10;2 sticks unsalted butter&#10;12 large eggs&#10;1 cup chocolate chips"></textarea></label>
    <div><button class="btn sm" data-act="pantry-paste">Add to pantry</button></div>
    ${manage}${confirmRemove}</section>`;
}
/* "2 1/2 cups light brown sugar" -> {qty: 2.5, unit: "cup", item: "light brown sugar"} */
const UNIT_WORDS = { tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", cup: "cup", cups: "cup", c: "cup", g: "g", gram: "g", grams: "g", kg: "kg", oz: "oz", ounce: "oz", ounces: "oz", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", ml: "ml", l: "l", liter: "l", stick: "stick", sticks: "stick", pinch: "pinch", bag: "each", bags: "each", dozen: "each" };
function parsePantryLine(line) {
  const m = line.trim().replace(/^[-*•]\s*/, "").match(/^([\d\s.\/½⅓⅔¼¾⅛⅜⅝⅞-]+)?\s*([a-zA-Z]+\.?)?\s+(.*)$/);
  if (!m) return line.trim() ? { qty: null, unit: "", item: line.trim() } : null;
  let qty = parseQty(m[1] || ""), word = (m[2] || "").toLowerCase().replace(/\.$/, ""), item = m[3].replace(/^of\s+/i, "").trim();
  let unit = UNIT_WORDS[word];
  if (word === "dozen" && qty != null) qty *= 12;
  if (!unit) { item = `${m[2] || ""} ${item}`.trim(); unit = qty != null ? "each" : ""; }
  return item ? { qty, unit, item: item.toLowerCase() } : null;
}
const fmtNoteDate = s => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
/* "Dec 1, 2026, 3:42 PM · Teren" — older notes saved before authors were recorded show only the date. */
const noteStamp = n => { const d = new Date(n.at); const when = isNaN(d) ? "" : `${fmtNoteDate(n.at)}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`; const edited = n.editedAt ? `edited${n.editedBy && n.editedBy !== n.by ? ` by ${personName(n.editedBy)}` : ""} ${fmtNoteDate(n.editedAt)}` : ""; return [when, n.by ? personName(n.by) : "", edited].filter(Boolean).join(" · "); };

/* ---------- modals ---------- */
function openModal(m) { S.modal = m; S.confirmDelete = null; S.editNote = null; S.confirmNote = null; renderModal(); }
function closeModal() { if (S.importCtl) { S.importCtl.abort(); S.importCtl = null; } S.modal = null; const el = $("#modal"); el.hidden = true; el.innerHTML = ""; document.body.style.overflow = ""; }
function renderModal() {
  const m = S.modal, el = $("#modal"); if (!m) return;
  const draft = document.getElementById("noteDraft")?.value;
  if (m.type === "detail") { const r = getR(m.id); if (!r) { closeModal(); return; } el.innerHTML = viewDetail(r); }
  else if (m.type === "import") el.innerHTML = viewImport();
  else if (m.type === "edit") el.innerHTML = viewEditor(m.draft, m.isNew);
  else if (m.type === "bakes") el.innerHTML = viewBakes();
  if (draft != null && document.getElementById("noteDraft")) document.getElementById("noteDraft").value = draft;
  el.hidden = false; document.body.style.overflow = "hidden";
}
function newBakeForm(copyFrom, partOf) {
  let d = defaultPlan().bakeDate;
  const main = partOf && S.bakes.find(b => b.id === partOf);
  if (main) { const x = parseDate(main.bakeDate); x.setDate(x.getDate() - 1); d = isoDate(x); }
  return { name: "", bakeDate: d, copyFrom: copyFrom || "", partOf: partOf || "" };
}
function viewBakes() {
  const f = S.bakeForm, today = isoDate(new Date());
  const opts = `<option value="">Start empty</option>` + S.bakes.map(b => `<option value="${esc(b.id)}" ${f && f.copyFrom === b.id ? "selected" : ""}>Same cookies as ${esc(b.name)}</option>`).join("");
  const form = f ? `<form class="bake-form panel" data-form="bake">
      <h3>${f && f.partOf ? "New prebake" : "New bake"}</h3>
      <div class="settings">
        <label class="field bake-name"><span class="label">Name</span><input id="nb-name" class="inp" maxlength="80" value="${esc(f.name)}" placeholder="${esc(f.partOf ? "e.g. Sapp prebake" : bakeNameFor(f.bakeDate))}"></label>
        <label class="field"><span class="label">Bake day</span><input id="nb-date" type="date" class="inp" value="${esc(f.bakeDate)}" required></label>
        <label class="field"><span class="label">Cookies</span><select id="nb-copy" class="inp">${opts}</select></label>
        <label class="field"><span class="label">Part of</span><select id="nb-partof" class="inp"><option value="">Nothing (a main bake)</option>${allBakes().filter(b => !(b.partOf && S.bakes.some(x => x.id === b.partOf))).sort(byDate).reverse().map(b => `<option value="${esc(b.id)}" ${f.partOf === b.id ? "selected" : ""}>Prebake for ${esc(b.name)}</option>`).join("")}</select></label>
      </div>
      <p class="muted" style="font-size:.85rem">Copying brings over the cookies, batch sizes, bakers and oven setup. The shopping list starts fresh and you can change anything.</p>
      <div style="display:flex;gap:8px"><button class="btn primary">Create bake</button><button type="button" class="btn ghost" data-act="bake-form-cancel">Cancel</button></div>
    </form>` : `<div><button class="btn primary" data-act="bake-new">New bake</button></div>`;
  const isKid = b => b.partOf && S.bakes.some(x => x.id === b.partOf);
  const ordered = S.bakes.filter(b => !isKid(b)).flatMap(m => [m, ...S.bakes.filter(k => k.partOf === m.id).sort(byDate)]);
  const rows = ordered.map(b => {
    const open = b.id === S.plan.id, when = b.bakeDate < today ? "past" : "upcoming";
    const cookies = b.cookies.length ? `${b.cookies.length} cookie${b.cookies.length > 1 ? "s" : ""}: ${b.cookies.slice(0, 4).map(esc).join(", ")}${b.cookies.length > 4 ? `, +${b.cookies.length - 4} more` : ""}` : "No cookies picked";
    const confirm = S.confirmBake === b.id ? `<div class="confirm"><span>Delete ${esc(b.name)}, its plan and its shopping checks? Recipes aren't affected.${S.bakes.some(k => k.partOf === b.id) ? " Its prebakes are kept as bakes of their own." : ""}</span><button class="btn danger solid sm" data-act="bake-del-yes" data-id="${esc(b.id)}">Delete</button><button class="btn sm" data-act="bake-del-no">Keep it</button></div>` : "";
    return `<div class="bake-row ${open ? "open" : ""} ${isKid(b) ? "kid" : ""}">
      <div style="min-width:0"><div class="nm">${esc(b.name)}${open ? ` <span class="chip">Open</span>` : ""}</div>
        <div class="sub">${isKid(b) ? "Prebake · " : S.bakes.some(k => k.partOf === b.id) ? "Main bake · " : ""}${esc(fmtDay(parseDate(b.bakeDate)))} · ${when}${b.bakers.length ? ` · ${b.bakers.map(e => esc(personName(e))).join(", ")}` : ""}</div>
        <div class="sub">${cookies}</div></div>
      <div class="bake-acts">${open ? "" : `<button class="btn sm" data-act="bake-open" data-id="${esc(b.id)}">Open</button>`}<button class="btn sm ghost" data-act="bake-copy" data-id="${esc(b.id)}">Copy</button><button class="btn sm ghost danger" data-act="bake-del" data-id="${esc(b.id)}" style="border-color:transparent">Delete</button></div>
      ${confirm}</div>`;
  }).join("");
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="bk-title">
    <div class="sheet-head"><div><h2 id="bk-title">Bakes</h2><p class="muted" style="margin-top:4px">Each bake keeps its own cookies, schedule, shopping checks and notes. The pantry and recipes are shared by all of them.</p></div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="sheet-body">${form}<div>${rows}</div></div></div>`;
}
function viewPhotos(r) {
  const imgs = r.images || [], up = S.uploading?.id === r.id ? S.uploading : null;
  const items = imgs.map((im, i) => `<figure class="thumb"><a href="/api/images/${esc(im.id)}" target="_blank" rel="noopener" title="Open full size"><img alt="Original photo ${i + 1}" loading="lazy" src="/api/images/${esc(im.id)}${im.thumb ? "?size=thumb" : ""}"></a>
    <figcaption>${im.type === "image/heic" && !im.thumb ? "HEIC · " : ""}${fmtSize(im.size)}</figcaption>
    <div class="thumb-acts"><a class="btn sm" href="/api/images/${esc(im.id)}?download=1" aria-label="Download photo ${i + 1}">↓</a><button class="btn sm" data-act="img-rm" data-id="${esc(r.id)}" data-img="${esc(im.id)}" aria-label="Remove photo ${i + 1}">✕</button></div></figure>`).join("");
  const confirm = S.confirmImg && imgs.some(i => i.id === S.confirmImg) ? `<div class="confirm"><span>Remove this photo for good?</span><button class="btn danger solid sm" data-act="img-rm-yes" data-id="${esc(r.id)}">Remove</button><button class="btn sm" data-act="img-rm-no">Keep it</button></div>` : "";
  return `<div><span class="label">Original photos</span>
    ${imgs.length ? `<div class="thumbs" style="margin-top:8px">${items}</div>` : `<p class="muted" style="font-size:.9rem;margin-top:4px">No photos yet. Keep a picture of the recipe card or page here.</p>`}
    ${confirm}
    ${up ? `<div class="status" style="margin-top:8px"><div class="spin"></div><span>Saving photo ${Math.min(up.done + 1, up.total)} of ${up.total}…</span></div>`
      : `<div style="margin-top:8px"><label class="btn sm" for="add-photo-${esc(r.id)}" style="cursor:pointer">+ Add photos</label><input id="add-photo-${esc(r.id)}" data-addphoto="${esc(r.id)}" type="file" accept="image/*" multiple hidden></div>`}</div>`;
}
const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
function viewDetail(r) {
  const s = scaleOf(r.id), on = !!S.plan.selections?.[r.id], src = safeUrl(r.link) || safeUrl(r.source), from = safeUrl(r.source) ? "" : r.source;
  const ings = (r.ingredients || []).map(g => {
    const q = g.qty == null || g.qty === "" ? null : num(g.qty) * s;
    const odd = g.unit === "each" && q != null && q % 1 > 0.01 && /egg/i.test(g.item) ? " (whisk, then measure)" : "";
    return `<li><span class="q">${esc(q == null ? "" : qtyText(q, g.unit) + " " + unitText(g.unit, q))}</span><span>${esc(g.item)}${g.prep ? `<span class="muted">, ${esc(g.prep)}</span>` : ""}${esc(odd)}</span></li>`;
  }).join("");
  const notes = (r.notes || []).slice().reverse().map(n => S.editNote === n.id
    ? `<div class="note editing"><span class="d">${esc(noteStamp(n))}</span><textarea id="noteEdit" rows="3" aria-label="Edit note">${esc(n.text)}</textarea><div class="note-acts"><button class="btn primary sm" data-act="note-save" data-id="${esc(r.id)}" data-note="${esc(n.id)}">Save</button><button class="btn sm" data-act="note-cancel">Cancel</button></div></div>`
    : `<div class="note"><span class="d">${esc(noteStamp(n))}</span><p>${esc(n.text)}</p><div class="note-acts"><button class="btn ghost sm" data-act="note-edit" data-note="${esc(n.id)}">Edit</button>${S.confirmNote === n.id ? `<button class="btn danger solid sm" data-act="del-note" data-id="${esc(r.id)}" data-note="${esc(n.id)}">Delete</button><button class="btn sm" data-act="note-cancel">Keep</button>` : `<button class="btn ghost sm" data-act="note-del-ask" data-note="${esc(n.id)}" aria-label="Delete note">Delete</button>`}</div></div>`).join("");
  const times = [["Prep", r.prepMinutes], ["Chill", r.chillMinutes], ["Bake", r.bakeMinutes], ["Cool", r.coolMinutes]].filter(x => num(x[1])).map(([k, v]) => `<span class="chip">${k} ${esc(fmtDur(num(v)))}</span>`).join("");
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <div class="sheet-head"><div><h2 id="dlg-title">${esc(r.name)}</h2><div class="chips" style="margin-top:8px">${r.ovenTempF ? `<span class="chip temp">${esc(r.ovenTempF)}°F</span>` : ""}${times}${r.example ? `<span class="chip ex">Example recipe</span>` : ""}${r.owner ? `<span class="chip">Owner: ${esc(personName(r.owner))}</span>` : ""}</div>${src || from ? `<p style="margin-top:8px;font-size:.85rem">${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">Original recipe on ${esc(hostOf(src))} ↗</a>` : ""}${src && from ? " · " : ""}${from ? `<span class="muted">From ${esc(from)}</span>` : ""}</p>` : ""}</div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="sheet-body">
      <div class="scale-box"><span class="label">Batch</span>${scaleControl(r)}<span class="out">${r.yieldCount ? `${Math.round(num(r.yieldCount) * s)} cookies` : ""}</span><button class="toggle" data-act="toggle" data-id="${esc(r.id)}" aria-pressed="${on}" style="margin-left:auto">${on ? "✓ On the bake plan" : "+ Add to bake plan"}</button></div>
      <div class="two"><div><span class="label">Ingredients${s !== 1 ? ` · scaled ${scaleLabel(s)}` : ""}</span><ul class="ing" style="margin-top:6px">${ings || `<li><span></span><span class="muted">No ingredients yet</span></li>`}</ul></div>
      <div style="display:flex;flex-direction:column;gap:12px"><div><span class="label">Notes for next time</span><div class="notes" style="margin-top:6px">${notes || `<p class="muted" style="font-size:.9rem">Nothing yet. Jot down what you'd change: bake a minute less, double the chips, chill overnight.</p>`}</div></div>
        <div class="field"><label class="label" for="noteDraft">Add a note</label><textarea id="noteDraft" rows="3" placeholder="e.g. Pulled at 10 min on the dark pans and they were perfect"></textarea><button class="btn" data-act="add-note" data-id="${esc(r.id)}" style="align-self:flex-start">Save note</button></div>
        ${r.makeAheadTip || num(r.doughKeepsDays) || r.freezable ? `<div><span class="label">Make ahead</span><p style="margin-top:4px;font-size:.92rem">${num(r.doughKeepsDays) ? `Dough keeps ${esc(r.doughKeepsDays)} day${num(r.doughKeepsDays) > 1 ? "s" : ""} in the fridge. ` : ""}${r.freezable ? "Freezes well. " : ""}${esc(r.makeAheadTip || "")}</p></div>` : ""}
        ${r.decorating ? `<div><span class="label">Decorating</span><p style="margin-top:4px;font-size:.92rem">${esc(r.decorating)}</p></div>` : ""}</div></div>
      ${viewPhotos(r)}
      ${(r.steps || []).length ? `<div><span class="label">Method</span><ol class="steps" style="margin-top:8px">${r.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol></div>` : ""}
      ${S.confirmDelete === r.id ? `<div class="confirm"><span>Delete ${esc(r.name)} and its notes for good?</span><button class="btn danger solid sm" data-act="del-yes" data-id="${esc(r.id)}">Delete</button><button class="btn sm" data-act="del-no">Keep it</button></div>` : ""}
    </div>
    <div class="sheet-foot"><button class="btn ghost danger" data-act="del-ask" data-id="${esc(r.id)}" style="margin-right:auto;border-color:transparent">Delete</button><button class="btn" data-act="edit" data-id="${esc(r.id)}">Edit recipe</button><button class="btn primary" data-act="close">Done</button></div>
  </div>`;
}

/* import */
const IMP = { mode: "link", url: "", text: "", files: [], busy: false, msg: "", err: false };
function viewImport() {
  const tabs = [["link", "Link"], ["photo", "Photo"], ["text", "Paste text"], ["manual", "Type it in"]];
  let body = "";
  if (IMP.mode === "link") body = `<div class="field"><label class="label" for="imp-url">Recipe web address</label><input id="imp-url" type="url" class="inp" placeholder="https://…" value="${esc(IMP.url)}"></div><p class="muted" style="font-size:.85rem">Some sites block automated readers. If one does, take a screenshot and use Photo, or paste the text.</p><div><button class="btn primary" data-act="imp-link" ${IMP.busy ? "disabled" : ""}>Read recipe</button></div>`;
  if (IMP.mode === "photo") {
    const n = IMP.files.length, full = n >= IMG_MAX;
    const pick = `<input id="imp-file" type="file" accept="image/*" multiple hidden><input id="imp-cam" type="file" accept="image/*" capture="environment" hidden>`;
    const buttons = full ? `<p class="muted" style="font-size:.88rem">That's the most pages one recipe can have (${IMG_MAX}).</p>`
      : `<div class="photo-btns">${TOUCH ? `<label class="btn ${n ? "" : "primary"}" for="imp-cam">${n ? "Take next page" : "Take photo"}</label>` : ""}<label class="btn" for="imp-file">${n ? "Add more pages" : TOUCH ? "Choose from photos" : "Choose photos"}</label></div>`;
    const intro = n ? `<p class="muted" style="font-size:.88rem">${n} page${n > 1 ? "s" : ""}, read in this order. ${full ? "" : "Add the next page, or read the recipe when you have them all."}</p>`
      : `<label class="drop" id="drop" for="imp-file"><b>${TOUCH ? "Photograph the recipe" : "Choose or drop photos"}</b><span class="muted" style="font-size:.88rem">A recipe card, cookbook page or screenshot. For a recipe that runs over several pages, add one photo per page, up to ${IMG_MAX}.</span></label>`;
    const thumbs = n ? `<div class="thumbs" id="drop">${IMP.files.map((f, i) => `<figure class="thumb"><img alt="Page ${i + 1}" src="${esc(f.url)}"><figcaption>Page ${i + 1}</figcaption><div class="thumb-acts">${i ? `<button class="btn sm" data-act="img-left" data-i="${i}" aria-label="Move page ${i + 1} earlier">←</button>` : ""}<button class="btn sm" data-act="img-del" data-i="${i}" aria-label="Remove page ${i + 1}">✕</button></div></figure>`).join("")}</div>` : "";
    body = `${pick}${intro}${thumbs}${buttons}<div><button class="btn primary" data-act="imp-photo" ${IMP.busy || !n ? "disabled" : ""}>Read recipe${n > 1 ? ` (${n} pages)` : ""}</button></div>`;
  }
  if (IMP.mode === "text") body = `<div class="field"><label class="label" for="imp-text">Recipe text</label><textarea id="imp-text" rows="10" class="inp" placeholder="Paste the whole recipe: title, ingredients, method…">${esc(IMP.text)}</textarea></div><div><button class="btn primary" data-act="imp-text" ${IMP.busy ? "disabled" : ""}>Read recipe</button></div>`;
  if (IMP.mode === "manual") body = `<p class="muted">Start from a blank recipe and fill in the ingredients, times and oven temperature yourself.</p><div><button class="btn primary" data-act="imp-manual">Start blank recipe</button></div>`;
  const status = IMP.busy ? `<div class="status"><div class="spin"></div><span>${esc(IMP.msg || "Claude is reading the recipe…")}</span><button class="btn ghost sm" data-act="imp-stop" style="margin-left:auto">Stop</button></div>` : IMP.msg ? `<div class="status ${IMP.err ? "err" : ""}">${esc(IMP.msg)}</div>` : "";
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="imp-title">
    <div class="sheet-head"><div><h2 id="imp-title">Add a recipe</h2><p class="muted" style="margin-top:4px">Claude pulls out the ingredients, times, oven temperature and make-ahead advice. You review everything before it's saved.</p></div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="sheet-body"><div class="seg">${tabs.map(([k, l]) => `<button data-act="imp-mode" data-mode="${k}" aria-pressed="${IMP.mode === k}">${l}</button>`).join("")}</div>${body}${status}</div></div>`;
}
async function runExtract(payload, busyMsg) {
  const ctl = new AbortController(); S.importCtl = ctl;
  IMP.busy = true; IMP.err = false; IMP.msg = busyMsg || "Claude is reading the recipe… this can take up to a minute."; renderModal();
  try {
    const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctl.signal });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { S.signedIn = false; closeModal(); render(); return; }
    if (!res.ok) throw new Error(d.error || "Something went wrong reading the recipe. Try again.");
    IMP.busy = false; IMP.msg = ""; S.importCtl = null;
    const draft = draftFrom(d.recipe, d.recipe.source || "");
    if (payload.kind === "images") { draft.photos = IMP.files; IMP.files = []; } // the original photos are saved with the recipe
    openModal({ type: "edit", isNew: true, draft });
  } catch (e) {
    S.importCtl = null; IMP.busy = false;
    if (e.name === "AbortError") IMP.msg = "";
    else { IMP.err = true; IMP.msg = e.message === "Failed to fetch" ? "Can't reach Cookie Repo. Check your connection and try again." : e.message; }
    if (S.modal?.type === "import") renderModal();
  }
}
function importLink() {
  const url = ($("#imp-url")?.value || "").trim(); IMP.url = url;
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) { IMP.err = true; IMP.msg = "Enter the full web address, starting with https://"; renderModal(); return; }
  runExtract({ kind: "url", url }, "Opening the page and reading the recipe… this can take up to a minute.");
}
/* Shrink photos in the browser before upload: about 1600 px on the long side is plenty for Claude to read a recipe. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("One of those photos couldn't be opened. Try a JPEG or PNG.")); };
    img.src = url;
  });
}
async function importPhotos() {
  try { const images = await Promise.all(IMP.files.map(f => shrinkImage(f.file))); runExtract({ kind: "images", images }); }
  catch (e) { IMP.err = true; IMP.msg = e.message; renderModal(); }
}
function draftFrom(j, source) {
  const n = v => (v == null || v === "" ? "" : String(Math.round(num(v) * 100) / 100));
  return {
    id: uid(), name: String(j.name || "Untitled cookies"), link: fixLink(j.link) || (safeUrl(source) ? source : "") || String(j.link || ""), source: safeUrl(source) ? "" : String(source || ""), owner: j.owner || S.me.email, yieldCount: n(j.yieldCount), prepMinutes: n(j.prepMinutes), chillMinutes: n(j.chillMinutes), bakeMinutes: n(j.bakeMinutes), ovenTempF: n(j.ovenTempF), cookiesPerSheet: n(j.cookiesPerSheet), coolMinutes: n(j.coolMinutes), doughKeepsDays: n(j.doughKeepsDays), freezable: !!j.freezable, makeAheadTip: String(j.makeAheadTip || ""), decorating: String(j.decorating || ""), decorateMinutes: n(j.decorateMinutes),
    ingredients: (j.ingredients || []).map(g => ({ qty: g.qty == null ? "" : frac(num(g.qty)).replace(/^(\d)([⅛¼⅓⅜½⅝⅔¾⅞])/, "$1 $2"), unit: UNITS.includes(String(g.unit || "").toLowerCase()) ? String(g.unit || "").toLowerCase() : "", item: String(g.item || ""), prep: String(g.prep || ""), category: CATS.includes(g.category) ? g.category : "Other" })),
    stepsText: (j.steps || []).map(String).join("\n"), notes: [],
  };
}
function blankDraft() { return draftFrom({ name: "", ingredients: [{ qty: null, unit: "cup", item: "", category: "Baking staples" }], steps: [], ovenTempF: 350, bakeMinutes: 11, prepMinutes: 20, cookiesPerSheet: 12, coolMinutes: 10, yieldCount: 24 }, ""); }
function draftFromRecipe(r) { const d = draftFrom(r, r.source); d.id = r.id; d.notes = clone(r.notes || []); d.example = !!r.example; d.ingredients = (r.ingredients || []).map(g => ({ qty: g.qty == null ? "" : String(g.qty), unit: g.unit || "", item: g.item || "", prep: g.prep || "", category: g.category || "Other" })); return d; }
function viewEditor(d, isNew) {
  const f = (k, label, type = "number", cls = "", extra = "") => `<label class="field ${cls}"><span class="label">${label}</span><input id="ed-${k}" data-f="${k}" type="${type}" ${type === "number" ? 'min="0" step="any" inputmode="decimal"' : ""} value="${esc(d[k])}" ${extra}></label>`;
  const rows = d.ingredients.map((g, i) => `<div class="ing-row">
      <input id="ing-${i}-qty" data-ing="${i}" data-k="qty" value="${esc(g.qty)}" placeholder="2 ¼" aria-label="Quantity">
      <select id="ing-${i}-unit" data-ing="${i}" data-k="unit" aria-label="Unit">${UNITS.map(u => `<option value="${u}" ${u === g.unit ? "selected" : ""}>${u || "—"}</option>`).join("")}</select>
      <input id="ing-${i}-item" data-ing="${i}" data-k="item" value="${esc(g.item)}" placeholder="all-purpose flour" aria-label="Ingredient">
      <input class="opt" id="ing-${i}-prep" data-ing="${i}" data-k="prep" value="${esc(g.prep)}" placeholder="softened" aria-label="Prep note">
      <select class="opt" id="ing-${i}-cat" data-ing="${i}" data-k="category" aria-label="Shopping aisle">${CATS.map(c => `<option ${c === g.category ? "selected" : ""}>${c}</option>`).join("")}</select>
      <button class="x" data-act="ing-del" data-i="${i}" aria-label="Remove ingredient" style="font-size:1.1rem">×</button></div>`).join("");
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">
    <div class="sheet-head"><div><h2 id="ed-title">${isNew ? "Check the recipe" : "Edit recipe"}</h2>${isNew ? `<p class="muted" style="margin-top:4px">Claude filled this in. Fix anything it misread, then save.</p>` : ""}</div><button class="x" data-act="close" aria-label="Close">×</button></div>
    <div class="sheet-body">
      ${isNew && d.photos?.length && safeUrl(d.link) ? `<div class="banner relink"><span>The photo shows a web address: <b>${esc(hostOf(d.link))}</b>. If the photo is hard to read, Claude can read the recipe from the website instead. Your photos stay with the recipe either way.</span>
        ${S.modal.relink?.busy ? `<span class="status"><span class="spin"></span>Reading the website…</span>` : `<button class="btn sm" data-act="relink">Read from the website instead</button>`}${S.modal.relink?.msg ? `<span class="status err">${esc(S.modal.relink.msg)}</span>` : ""}</div>` : ""}
      <div class="form-grid">
        ${f("name", "Name", "text", "wide", 'placeholder="Brown butter chocolate chip"')}
        <label class="field wide"><span class="label">Owner</span>${personSelect("ed-owner", d.owner, `data-f="owner"`, "Recipe owner", "No owner")}</label>
        ${f("yieldCount", "Makes (cookies)")}${f("ovenTempF", "Oven °F")}${f("bakeMinutes", "Bake min / sheet")}${f("cookiesPerSheet", "Cookies / sheet")}
        ${f("prepMinutes", "Prep min")}${f("chillMinutes", "Chill min")}${f("coolMinutes", "Cool min")}${f("doughKeepsDays", "Dough keeps (days)")}
        <label class="check wide"><input type="checkbox" id="ed-freezable" data-f="freezable" ${d.freezable ? "checked" : ""}>Dough or cookies freeze well</label>
        ${f("decorateMinutes", "Decorating min", "number", "")}
        ${f("makeAheadTip", "Make-ahead tip", "text", "full")}
        ${f("decorating", "Decorating", "text", "full", 'placeholder="Royal icing once fully cool"')}
        ${f("link", "Link to the original recipe", "url", "full", 'placeholder="https://…" inputmode="url"')}
        ${f("source", "Book or other source", "text", "full", 'placeholder="Grandma\'s recipe card, or a cookbook and page"')}
        ${d.photos?.length ? `<div class="full"><span class="label">Original photo${d.photos.length > 1 ? "s" : ""}</span><div class="thumbs" style="margin-top:6px">${d.photos.map((f, i) => `<figure class="thumb"><img alt="Page ${i + 1}" src="${esc(f.url)}"><figcaption>Page ${i + 1}</figcaption></figure>`).join("")}</div><p class="muted" style="font-size:.85rem;margin-top:6px">Saved with the recipe at full size.</p></div>` : ""}
      </div>
      <div class="ing-edit"><span class="label">Ingredients</span>
        <div class="ing-row ing-head"><span>Qty</span><span>Unit</span><span>Ingredient</span><span class="opt">Prep</span><span class="opt">Aisle</span><span></span></div>
        ${rows}<div><button class="btn sm" data-act="ing-add">+ Add ingredient</button></div></div>
      <label class="field"><span class="label">Method, one step per line</span><textarea id="ed-steps" data-f="stepsText" rows="7">${esc(d.stepsText)}</textarea></label>
      <p class="status err" id="ed-err" hidden></p>
    </div>
    <div class="sheet-foot"><button class="btn ghost" data-act="close">Cancel</button><button class="btn primary" data-act="ed-save">Save recipe</button></div></div>`;
}
async function saveDraft(btn) {
  const d = S.modal.draft, err = $("#ed-err");
  if (!d.name.trim()) { err.hidden = false; err.textContent = "Give the recipe a name."; $("#ed-name")?.focus(); return; }
  const n = v => (v === "" || v == null ? null : num(v));
  const old = getR(d.id);
  const rec = {
    id: d.id, name: d.name.trim(), link: d.link.trim(), source: d.source.trim(), yieldCount: n(d.yieldCount), prepMinutes: n(d.prepMinutes), chillMinutes: n(d.chillMinutes) || 0, bakeMinutes: n(d.bakeMinutes), ovenTempF: n(d.ovenTempF), cookiesPerSheet: n(d.cookiesPerSheet), coolMinutes: n(d.coolMinutes), doughKeepsDays: n(d.doughKeepsDays) || 0, freezable: !!d.freezable, makeAheadTip: d.makeAheadTip.trim(), decorating: d.decorating.trim(), decorateMinutes: n(d.decorateMinutes) || 0,
    ingredients: d.ingredients.filter(g => g.item.trim()).map(g => ({ qty: parseQty(g.qty), unit: g.unit, item: g.item.trim(), prep: g.prep.trim(), category: g.category })),
    steps: d.stepsText.split("\n").map(s => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean),
    owner: d.owner || "", notes: old ? clone(old.notes || []) : d.notes || [], example: !!(old && old.example && d.example), createdAt: old?.createdAt || new Date().toISOString(),
  };
  if (rec.link && !safeUrl(rec.link)) { err.hidden = false; err.textContent = "The link should start with https://"; $("#ed-link")?.focus(); return; }
  btn.disabled = true;
  const ok = await saveRecipe(rec);
  btn.disabled = false;
  if (!ok) return;
  toast(old ? "Recipe saved" : `${rec.name} added`);
  const photos = d.photos || [];
  openModal({ type: "detail", id: rec.id });
  if (photos.length) await uploadPhotos(rec.id, photos.map(p => p.file));
  photos.forEach(p => URL.revokeObjectURL(p.url));
}

/* ---------- original photos ---------- */
function shrinkToBlob(file, max) {
  return new Promise(resolve => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); }; // e.g. HEIC outside Safari: keep the original, skip the preview
    img.src = url;
  });
}
async function uploadPhotos(recipeId, files) {
  S.uploading = { id: recipeId, done: 0, total: files.length }; if (S.modal?.type === "detail") renderModal();
  const start = (getR(recipeId)?.images || []).length;
  let failed = 0;
  for (const [i, file] of files.entries()) {
    try {
      const res = await fetch(`/api/recipes/${encodeURIComponent(recipeId)}/images?page=${start + i}`, { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "A photo couldn't be saved.");
      let images = d.images;
      const thumb = await shrinkToBlob(file, 480);
      if (thumb) { const t = await fetch(`/api/images/${d.id}/thumb`, { method: "PUT", body: thumb, headers: { "Content-Type": "image/jpeg" } }); if (t.ok) images = (await t.json()).images; }
      const r = getR(recipeId); if (r) r.images = images;
    } catch (e) { failed++; toast(e.message === "Failed to fetch" ? "Lost the connection while saving a photo." : e.message); }
    S.uploading.done = i + 1; if (S.modal?.type === "detail") renderModal();
  }
  S.uploading = null; render();
  if (!failed) toast(files.length > 1 ? `${files.length} photos saved` : "Photo saved");
}

/* ---------- events ---------- */
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
function go(tab) { S.tab = tab; if (location.hash.slice(1) !== tab) location.hash = tab; render(); window.scrollTo(0, 0); }
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) { S.tab = h; render(); } });

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-act]"); if (!el) { if (e.target.id === "modal") closeModal(); return; }
  const a = el.dataset.act, id = el.dataset.id;
  if (el.tagName === "A") e.preventDefault();
  if (a === "tab") { closeModal(); go(el.dataset.tab); }
  else if (a === "open") openModal({ type: "detail", id });
  else if (a === "toggle") { e.stopPropagation(); toggleBake(id); if (S.modal?.type === "detail") renderModal(); }
  else if (a === "close") closeModal();
  else if (a === "import") { Object.assign(IMP, { busy: false, msg: "", err: false }); openModal({ type: "import" }); }
  else if (a === "imp-mode") { if (IMP.busy) return; IMP.mode = el.dataset.mode; IMP.msg = ""; IMP.err = false; renderModal(); }
  else if (a === "imp-link") importLink();
  else if (a === "imp-text") { IMP.text = $("#imp-text").value; if (IMP.text.trim().length < 40) { IMP.err = true; IMP.msg = "Paste the full recipe, including the ingredient list."; renderModal(); return; } runExtract({ kind: "text", text: IMP.text }); }
  else if (a === "imp-photo") importPhotos();
  else if (a === "img-del") { const [f] = IMP.files.splice(Number(el.dataset.i), 1); if (f) URL.revokeObjectURL(f.url); IMP.msg = ""; renderModal(); }
  else if (a === "img-left") { const i = Number(el.dataset.i); if (i > 0) { [IMP.files[i - 1], IMP.files[i]] = [IMP.files[i], IMP.files[i - 1]]; renderModal(); } }
  else if (a === "imp-stop") { S.importCtl?.abort(); }
  else if (a === "imp-manual") openModal({ type: "edit", isNew: false, draft: blankDraft() });
  else if (a === "edit") { const r = getR(id); if (r) openModal({ type: "edit", isNew: false, draft: draftFromRecipe(r) }); }
  else if (a === "ing-add") { S.modal.draft.ingredients.push({ qty: "", unit: "", item: "", prep: "", category: "Other" }); renderModal(); $(`#ing-${S.modal.draft.ingredients.length - 1}-qty`)?.focus(); }
  else if (a === "ing-del") { S.modal.draft.ingredients.splice(Number(el.dataset.i), 1); renderModal(); }
  else if (a === "ed-save") saveDraft(el);
  else if (a === "add-note") {
    const ta = $("#noteDraft"), text = ta.value.trim(); if (!text || !getR(id)) return;
    el.disabled = true;
    try { putRecipe(await api("POST", `/api/recipes/${encodeURIComponent(id)}/notes`, { text })); ta.value = ""; toast("Note saved"); }
    catch (err) { writeErr(err); }
    el.disabled = false; renderModal();
  }
  else if (a === "note-edit") { S.editNote = el.dataset.note; S.confirmNote = null; renderModal(); const t = $("#noteEdit"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  else if (a === "note-del-ask") { S.confirmNote = el.dataset.note; S.editNote = null; renderModal(); }
  else if (a === "note-cancel") { S.editNote = null; S.confirmNote = null; renderModal(); }
  else if (a === "note-save") {
    const text = ($("#noteEdit")?.value || "").trim(); if (!text) { toast("A note can't be empty. Delete it instead."); return; }
    el.disabled = true;
    try { putRecipe(await api("PATCH", `/api/recipes/${encodeURIComponent(id)}/notes/${encodeURIComponent(el.dataset.note)}`, { text })); S.editNote = null; toast("Note updated"); }
    catch (err) { writeErr(err); el.disabled = false; }
    renderModal();
  }
  else if (a === "del-note") { S.confirmNote = null; try { putRecipe(await api("DELETE", `/api/recipes/${encodeURIComponent(id)}/notes/${encodeURIComponent(el.dataset.note)}`)); } catch (err) { writeErr(err); } renderModal(); }
  else if (a === "relink") {
    const m = S.modal, d = m.draft; m.relink = { busy: true, msg: "" }; renderModal();
    try {
      const r = await api("POST", "/api/extract", { kind: "url", url: d.link });
      if (S.modal !== m) return;
      const nd = draftFrom(r.recipe, ""); nd.id = d.id; nd.photos = d.photos; nd.owner = d.owner;
      m.draft = nd; m.relink = null; toast("Read from the website. Check it over, then save."); renderModal();
    } catch (err) { if (S.modal === m) { m.relink = { busy: false, msg: `${err.message} The details from your photo are unchanged.` }; renderModal(); } }
  }
  else if (a === "img-rm") { S.confirmImg = el.dataset.img; renderModal(); }
  else if (a === "img-rm-no") { S.confirmImg = null; renderModal(); }
  else if (a === "img-rm-yes") {
    const imgId = S.confirmImg; S.confirmImg = null;
    try { const d = await api("DELETE", `/api/images/${encodeURIComponent(imgId)}`); const r = getR(id); if (r) r.images = d.images; toast("Photo removed"); } catch (err) { writeErr(err); }
    renderModal();
  }
  else if (a === "del-ask") { S.confirmDelete = id; renderModal(); }
  else if (a === "del-no") { S.confirmDelete = null; renderModal(); }
  else if (a === "del-yes") { const r = getR(id); closeModal(); await deleteRecipe(id); toast(`Deleted ${r ? r.name : "recipe"}`); }
  else if (a === "copy-list") {
    const txt = shopping(S.shopFilter).filter(g => !g.covered).map(g => `${g.cat}\n` + g.items.filter(x => !(S.plan.have || {})[x.key]).map(x => `- ${x.item}: ${x.status === "partial" ? x.buyText : x.amount}${x.hint ? ` (${x.hint})` : ""}`).join("\n")).join("\n\n");
    try { await navigator.clipboard.writeText(txt); toast("Shopping list copied"); } catch { toast("Couldn't copy. Select the list and copy it by hand."); }
  }
  else if (a === "clear-have") { S.plan.have = {}; savePlan(); }
  else if (a === "reload") loadState();
  else if (a === "search-clear") { S.q = ""; S.ownerFilter = ""; render(); $("#recipe-q")?.focus(); }
  else if (a === "bakes") { S.bakeForm = null; S.confirmBake = null; openModal({ type: "bakes" }); }
  else if (a === "bake-new" || a === "bake-copy") { S.bakeForm = newBakeForm(a === "bake-copy" ? id : ""); S.confirmBake = null; if (S.modal?.type === "bakes") renderModal(); else openModal({ type: "bakes" }); $("#nb-name")?.focus(); }
  else if (a === "prebake-new") { S.bakeForm = newBakeForm("", id); S.confirmBake = null; openModal({ type: "bakes" }); $("#nb-name")?.focus(); }
  else if (a === "noop") {}
  else if (a === "shop-scope") { S.plan.shopScope = el.dataset.scope; if (el.dataset.scope === "custom" && !(S.plan.shopBakes || []).length) S.plan.shopBakes = family().map(b => b.id); S.shopFilter = ""; savePlan(); }
  else if (a === "bake-form-cancel") { S.bakeForm = null; renderModal(); }
  else if (a === "bake-open") { if (await bakeCall("POST", `/api/bakes/${encodeURIComponent(id)}/open`, null)) { closeModal(); toast(`Opened ${S.plan.name}`); if (S.tab !== "shopping") go("plan"); } }
  else if (a === "bake-del") { S.confirmBake = id; renderModal(); }
  else if (a === "bake-del-no") { S.confirmBake = null; renderModal(); }
  else if (a === "bake-del-yes") { S.confirmBake = null; const b = S.bakes.find(x => x.id === id); await bakeCall("DELETE", `/api/bakes/${encodeURIComponent(id)}`, null, `Deleted ${b ? b.name : "bake"}`); }
  else if (a === "examples") { el.disabled = true; try { const d = await api("POST", "/api/examples"); S.recipes = d.recipes.sort((x, y) => String(x.name).localeCompare(String(y.name))); render(); toast("Example recipes added"); } catch (err) { toast(err.message); el.disabled = false; } }
  else if (a === "login-back") { S.login = { step: "email", email: S.login.email, busy: false, msg: "", err: false }; render(); }
  else if (a === "login-resend") requestCode(S.login.email);
  else if (a === "logout") { try { await api("POST", "/api/auth/logout"); } catch {} S.signedIn = false; S.recipes = []; S.people = []; render(); }
  else if (a === "person-del") { S.confirmPerson = el.dataset.email; render(); }
  else if (a === "person-del-no") { S.confirmPerson = null; render(); }
  else if (a === "person-del-yes") { const em = S.confirmPerson; S.confirmPerson = null; if (await peopleCall("DELETE", `/api/people/${encodeURIComponent(em)}`)) toast("Removed"); }
  else if (a === "pantry-add") { const p = curPantry(); if (!p) return; p.items.push({ id: uid(), item: "", qty: null, unit: "" }); savePantry(p); $(`#pt-${p.items.length - 1}-qty`)?.focus(); }
  else if (a === "pantry-del") { const p = curPantry(); if (!p) return; p.items.splice(Number(el.dataset.i), 1); savePantry(p); }
  else if (a === "pantry-new") {
    try { const d = await api("POST", "/api/pantries", { name: "New pantry" }); S.pantries = d.pantries; S.plan.pantryId = d.pantry.id; savePlan(); toast("Pantry added. Give it a name."); $("#pantry-name")?.select(); } catch (err) { writeErr(err); }
  }
  else if (a === "pantry-remove") { S.confirmPantryRemove = true; render(); }
  else if (a === "pantry-remove-no") { S.confirmPantryRemove = false; render(); }
  else if (a === "pantry-remove-yes") {
    const p = curPantry(); S.confirmPantryRemove = false; if (!p) return;
    try { await api("DELETE", `/api/pantries/${encodeURIComponent(p.id)}`); await settlePlan(); toast(`Deleted ${p.name}`); loadState(); } catch (err) { writeErr(err); }
  }
  else if (a === "pantry-clear") { S.confirmPantryClear = true; render(); }
  else if (a === "pantry-clear-no") { S.confirmPantryClear = false; render(); }
  else if (a === "pantry-clear-yes") { S.confirmPantryClear = false; const p = curPantry(); if (p) { p.items = []; savePantry(p); } }
  else if (a === "pantry-paste") {
    const lines = ($("#pantry-paste")?.value || "").split(/\n+/).map(parsePantryLine).filter(Boolean);
    if (!lines.length) { toast("Type or paste at least one item."); return; }
    const p = curPantry(); if (!p) return; p.items.push(...lines.map(l => ({ id: uid(), ...l }))); savePantry(p); toast(`Added ${lines.length} item${lines.length > 1 ? "s" : ""} to the pantry`);
  }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && S.modal) closeModal();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".card[data-act='open']")) { e.preventDefault(); openModal({ type: "detail", id: e.target.dataset.id }); }
});
document.addEventListener("change", e => {
  const el = e.target, c = el.dataset.change;
  if (c === "baker") setBaker(el.dataset.id, el.value);
  else if (c === "owner-filter") { S.ownerFilter = el.value; render(); }
  else if (c === "baker-filter") { S.bakerFilter = el.value; render(); }
  else if (c === "shop-filter") { S.shopFilter = el.value; render(); }
  else if (c === "person-name") peopleCall("PATCH", `/api/people/${encodeURIComponent(el.dataset.email)}`, { name: el.value });
  else if (el.dataset.pantry != null) { const p = curPantry(), it = p?.items[Number(el.dataset.pantry)]; if (it) { it[el.dataset.k] = el.dataset.k === "qty" ? parseQty(el.value) : el.value; savePantry(p); } }
  else if (c === "pantry-name") { const p = curPantry(); if (p && el.value.trim()) { p.name = el.value.trim(); savePantry(p); } }
  else if (c === "person-pantry") peopleCall("PATCH", `/api/people/${encodeURIComponent(el.dataset.email)}`, { pantry: el.value });
  else if (c === "scale") { setScale(el.dataset.id, el.value); if (S.modal?.type === "detail") renderModal(); }
  else if (el.id === "nb-date" && S.bakeForm) { S.bakeForm.bakeDate = el.value; const n = $("#nb-name"); if (n) n.placeholder = bakeNameFor(el.value); }
  else if (el.id === "nb-copy" && S.bakeForm) S.bakeForm.copyFrom = el.value;
  else if (el.id === "nb-partof" && S.bakeForm) { S.bakeForm.partOf = el.value; S.bakeForm.name = $("#nb-name").value; renderModal(); }
  else if (c === "shop-bake") { const set = new Set(S.plan.shopBakes?.length ? S.plan.shopBakes : [S.plan.id]); if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id); S.plan.shopBakes = [...set]; savePlan(); }
  else if (c === "plan") { const k = el.dataset.k; S.plan[k] = el.type === "checkbox" ? el.checked : (["ovens", "sheetsPerOven"].includes(k) ? Number(el.value) : el.value); savePlan(); }
  else if (c === "have") { S.plan.have = { ...(S.plan.have || {}) }; if (el.checked) S.plan.have[el.dataset.key] = true; else delete S.plan.have[el.dataset.key]; savePlan(); }
  else if (el.id === "imp-file" || el.id === "imp-cam") { addFiles(el.files); el.value = ""; }
  else if (el.dataset.addphoto) { const files = [...el.files]; el.value = ""; if (files.length) uploadPhotos(el.dataset.addphoto, files); }
  else if (el.dataset.f === "freezable" && S.modal?.draft) S.modal.draft.freezable = el.checked;
  else if (el.dataset.ing != null && el.tagName === "SELECT") S.modal.draft.ingredients[Number(el.dataset.ing)][el.dataset.k] = el.value;
});
document.addEventListener("input", e => {
  if (e.target.id === "recipe-q") { S.q = e.target.value; const box = $("#recipe-results"); if (box) box.innerHTML = recipeResults(); return; }
  const el = e.target, d = S.modal?.draft;
  if (el.id === "imp-url") IMP.url = el.value; else if (el.id === "imp-text") IMP.text = el.value;
  if (!d) return;
  if (el.dataset.f && el.type !== "checkbox") d[el.dataset.f] = el.value;
  if (el.dataset.ing != null) d.ingredients[Number(el.dataset.ing)][el.dataset.k] = el.value;
});
/* Photos add up as pages, so a phone can take one picture per page. */
function addFiles(list) {
  const imgs = [...list].filter(f => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
  const room = IMG_MAX - IMP.files.length;
  IMP.files.push(...imgs.slice(0, room).map(file => ({ file, url: URL.createObjectURL(file) })));
  IMP.msg = imgs.length > room ? `A recipe can have up to ${IMG_MAX} pages, so ${imgs.length - room} photo${imgs.length - room > 1 ? "s were" : " was"} left out.` : ""; IMP.err = false; renderModal();
}
document.addEventListener("dragover", e => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", e => { e.target.closest?.("#drop")?.classList.remove("over"); });
document.addEventListener("drop", e => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
document.addEventListener("paste", e => { if (S.modal?.type === "import" && IMP.mode === "photo" && e.clipboardData?.files?.length) addFiles(e.clipboardData.files); });

document.addEventListener("submit", async e => {
  const form = e.target.dataset?.form; if (!form) return;
  e.preventDefault();
  if (form === "email") requestCode(String($("#login-email").value || "").trim().toLowerCase());
  else if (form === "code") submitCode($("#login-code").value);
  else if (form === "bake") {
    const f = S.bakeForm; if (!f) return;
    f.name = $("#nb-name").value.trim(); f.bakeDate = $("#nb-date").value; f.copyFrom = $("#nb-copy").value; f.partOf = $("#nb-partof").value;
    if (!f.bakeDate) { toast("Pick a date for the bake."); return; }
    if (await bakeCall("POST", "/api/bakes", { name: f.name || (f.partOf ? "Prebake" : bakeNameFor(f.bakeDate)), bakeDate: f.bakeDate, copyFrom: f.copyFrom || undefined, partOf: f.partOf || undefined })) {
      S.bakeForm = null; closeModal(); toast(`${S.plan.name} is ready`); go("plan");
    }
  }
  else if (form === "person") {
    const email = $("#np-email").value.trim(), name = $("#np-name").value.trim();
    if (await peopleCall("POST", "/api/people", { email, name })) toast(`${name || email} can now sign in`);
  }
});
render();
loadState();
