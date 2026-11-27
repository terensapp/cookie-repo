import dns from "node:dns/promises";
import net from "node:net";
import { ExtractError } from "./extract.js";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 60000;

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivateIP(l.slice(7));
  return l === "::" || l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

async function assertPublic(url) {
  if (!["http:", "https:"].includes(url.protocol)) throw new ExtractError("Only http and https links can be read.", 400);
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new ExtractError("That web address couldn't be found.", 400);
  if (addrs.some((a) => isPrivateIP(a.address))) throw new ExtractError("That address points to a private network.", 400);
}

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&frac12;/g, "½").replace(/&frac14;/g, "¼").replace(/&frac34;/g, "¾")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** Recipe sites usually embed schema.org Recipe JSON-LD, which is the most reliable part of the page. */
function recipeJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/"@type"\s*:\s*(\[[^\]]*)?"Recipe"/.test(m[1])) out.push(m[1].trim());
  }
  return out.join("\n").slice(0, 30000);
}

function pageText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/tr|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/* Fetch a public URL: every hop (redirects included) is checked against private networks, and the body is size-capped. */
async function safeFetch(url, accept, maxBytes, failMsg) {
  let res;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (compatible; CookieRepo/1.0; recipe reader)", Accept: accept } });
    } catch { throw new ExtractError(failMsg, 502); }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url); continue; }
    break;
  }
  const reader = res.body.getReader();
  const chunks = []; let size = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > maxBytes) { truncated = true; reader.cancel(); break; }
  }
  return { url, res, buf: Buffer.concat(chunks), truncated };
}

/* The recipe's own photo: schema.org Recipe "image" first, then the page's social-sharing image. */
function recipeImageUrl(html, base) {
  // Sites often list several sizes; take the biggest (by stated width, else the "-1200x800" in the file name; no size usually means the original).
  const size = (c) => c.w || (() => { const m = c.u.match(/(\d{2,4})x(\d{2,4})/); return m ? Number(m[1]) * Number(m[2]) / 1000 : 5000; })();
  const cands = (img) => typeof img === "string" ? [{ u: img }] : Array.isArray(img) ? img.flatMap(cands) : img && typeof img === "object" ? [...(img.url || img.contentUrl ? [{ u: img.url || img.contentUrl, w: Number(img.width) || 0 }] : []), ...cands(img["@list"])] : [];
  const pick = (img) => cands(img).filter((c) => typeof c.u === "string" && c.u).sort((a, b) => size(b) - size(a))[0]?.u || "";
  const findRecipe = (node) => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
    const t = node["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return node;
    return findRecipe(node["@graph"]) || findRecipe(node.mainEntity);
  };
  let found = "";
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const r = findRecipe(JSON.parse(m[1].trim())); if (r && (found = pick(r.image))) break; } catch { /* not valid JSON: skip */ }
  }
  if (!found) {
    const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i)?.[0];
    found = meta?.match(/content=["']([^"']+)["']/i)?.[1] || "";
  }
  try { return found ? new URL(decode(found), base).href : ""; } catch { return ""; }
}

function sniffPhoto(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  return null;
}

/** Download the recipe's photo for the cookie photo. Never throws: a missing or odd photo just means no photo. */
export async function fetchRecipeImage(raw) {
  try {
    const { res, buf, truncated } = await safeFetch(new URL(raw), "image/webp,image/jpeg,image/png;q=0.9", 5 * 1024 * 1024, "image didn't load");
    const type = res.ok && !truncated ? sniffPhoto(buf) : null;
    return type ? { media_type: type, data: buf.toString("base64") } : null;
  } catch { return null; }
}

/** Fetch a recipe page and return text for Claude: structured recipe data first, then the readable page text. */
export async function fetchRecipePage(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new ExtractError("Enter the full web address, starting with https://", 400); }
  const got = await safeFetch(url, "text/html,application/xhtml+xml", MAX_BYTES, "That page didn't respond. Check the address, or paste the recipe text instead.");
  const res = got.res; url = got.url;
  if (!res.ok) throw new ExtractError(`That site returned an error (${res.status}). Some sites block automated readers; paste the recipe text or use a screenshot instead.`, 502);
  const html = got.buf.toString("utf8");
  const ld = recipeJsonLd(html);
  const text = pageText(html).slice(0, MAX_TEXT);
  if (!ld && text.length < 200) throw new ExtractError("That page came back nearly empty. Paste the recipe text or use a screenshot instead.", 422);
  return { url: url.href, imageUrl: recipeImageUrl(html, url), text: `Web page: ${url.href}\nIgnore navigation, ads, stories and comments.\n\n${ld ? `Structured recipe data from the page:\n${ld}\n\n` : ""}Page text:\n${text}` };
}
