import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

// リダイレクトを手動で追い、最終的な URL を返す
export async function resolveRedirect(url, { maxHops = 5, timeoutMs = 15000 } = {}) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(current, { method: "GET", redirect: "manual", headers: { "user-agent": UA }, signal: ac.signal });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        current = new URL(loc, current).toString();
        continue;
      }
      return current;
    } finally {
      clearTimeout(t);
    }
  }
  return current;
}

const SHORTENER_RE = /^(t\.co|bit\.ly|goo\.gl|ow\.ly|tinyurl\.com|buff\.ly|lnkd\.in|x\.gd|is\.gd)$/i;

// 短縮 URL をリンク先に展開する。t.co はブラウザ以外には meta refresh のページを返すので本文も見る
export async function resolveShortLink(url, { timeoutMs = 10000 } = {}) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
  if (!SHORTENER_RE.test(host)) return url;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal, redirect: "follow" });
    if (!SHORTENER_RE.test(new URL(r.url).hostname.replace(/^www\./, ""))) return r.url;
    const html = (await r.text()).slice(0, 20000);
    const m =
      html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i) ||
      html.match(/<title>\s*(https?:\/\/[^<\s]+)\s*<\/title>/i);
    return m ? m[1].replace(/&amp;/g, "&") : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const TRACKING_PARAMS = /^(utm_|ref$|ref_|source$|fbclid|gclid|mc_)/i;

// 比較用に URL を正規化（トラッキングパラメータ・末尾スラッシュ・www を除去）
export function normalizeUrl(input) {
  try {
    const u = new URL(input);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    let s = u.toString();
    s = s.replace(/\/+$/, "").replace(/\?$/, "");
    return s;
  } catch {
    return input.trim();
  }
}

// Google 検索結果・SNS のクッション URL から実際のリンク先を取り出す
function unwrapUrl(u) {
  const wrapped =
    (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && /^\/url\/?$/.test(u.pathname) && (u.searchParams.get("q") || u.searchParams.get("url"))) ||
    (/^l\.(facebook|instagram)\.com$/.test(u.hostname) && u.searchParams.get("u")) ||
    "";
  if (!/^https?:\/\//.test(wrapped)) return u;
  try {
    return new URL(wrapped);
  } catch {
    return u;
  }
}

// ストアページはアプリを特定する部分だけ残す（アフィリエイト等のパラメータが壊れていると 404 になる）
function normalizeStoreUrl(u) {
  if (u.hostname === "apps.apple.com") {
    const id = u.pathname.match(/\/id(\d+)/)?.[1];
    // 国指定なしの URL は米国ストア扱いになり、日本限定アプリは 404 になる
    const cc = u.pathname.match(/^\/([a-z]{2})\//)?.[1] || "jp";
    if (id) return new URL(`https://apps.apple.com/${cc}/app/id${id}`);
  }
  if (u.hostname === "play.google.com" && u.searchParams.get("id")) {
    return new URL(`https://play.google.com/store/apps/details?id=${u.searchParams.get("id")}`);
  }
  return u;
}

// 表示用 URL（ref=... などトラッキングだけ落とす）
export function cleanUrl(input) {
  try {
    const u = normalizeStoreUrl(unwrapUrl(new URL(input)));
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    }
    return u.toString().replace(/\?$/, "");
  } catch {
    return input;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function idOf(url) {
  return createHash("sha1").update(normalizeUrl(url)).digest("hex").slice(0, 12);
}

export async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}]`, ...args);
}

export function truncate(s, n) {
  if (!s) return "";
  s = s.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
