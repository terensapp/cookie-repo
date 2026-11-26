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

/** Fetch a recipe page and return text for Claude: structured recipe data first, then the readable page text. */
export async function fetchRecipePage(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new ExtractError("Enter the full web address, starting with https://", 400); }
  let res;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CookieTin/1.0; recipe reader)", Accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      throw new ExtractError("That page didn't respond. Check the address, or paste the recipe text instead.", 502);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location"), url); continue; }
    break;
  }
  if (!res.ok) throw new ExtractError(`That site returned an error (${res.status}). Some sites block automated readers; paste the recipe text or use a screenshot instead.`, 502);

  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > MAX_BYTES) { reader.cancel(); break; }
  }
  const html = Buffer.concat(chunks).toString("utf8");
  const ld = recipeJsonLd(html);
  const text = pageText(html).slice(0, MAX_TEXT);
  if (!ld && text.length < 200) throw new ExtractError("That page came back nearly empty. Paste the recipe text or use a screenshot instead.", 422);
  return { url: url.href, text: `Web page: ${url.href}\nIgnore navigation, ads, stories and comments.\n\n${ld ? `Structured recipe data from the page:\n${ld}\n\n` : ""}Page text:\n${text}` };
}
