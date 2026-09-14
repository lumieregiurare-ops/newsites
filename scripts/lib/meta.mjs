// サイト自身が共有用に用意しているメタ情報（OGP）を取得する
import { UA } from "./util.mjs";
import { decodeEntities, stripTags } from "./xml.mjs";

function metaContent(html, names) {
  for (const name of names) {
    const re1 = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return "";
}

function absolutize(url, base) {
  if (!url) return "";
  try {
    const u = new URL(url, base);
    if (u.protocol === "http:") u.protocol = "https:"; // GitHub Pages(https) からの混在コンテンツを避ける
    return u.toString();
  } catch {
    return "";
  }
}

export async function fetchMeta(url, { timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "ja,en;q=0.8" },
      signal: ac.signal,
      redirect: "follow",
    });
    if (!r.ok) return { ok: false, status: r.status };
    const type = r.headers.get("content-type") || "";
    if (!/html/i.test(type)) return { ok: false, status: r.status, reason: "not html" };

    // 先頭 300KB だけ読めば <head> は十分に含まれる
    const reader = r.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < 300 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const html = new TextDecoder("utf-8").decode(Buffer.concat(chunks));

    const finalUrl = r.url || url;
    const lang = (html.match(/<html[^>]*\blang=["']([^"']+)["']/i) || [])[1] || "";
    const bodyText = stripTags(html.replace(/<head[\s\S]*?<\/head>/i, "")).slice(0, 4000);
    const ja = (bodyText.match(/[぀-ヿ一-鿿]/g) || []).length;

    return {
      ok: true,
      status: r.status,
      finalUrl,
      image: absolutize(metaContent(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]), finalUrl),
      description: metaContent(html, ["og:description", "twitter:description", "description"]).replace(/\s+/g, " ").trim(),
      siteName: metaContent(html, ["og:site_name"]),
      lang,
      jaRatio: bodyText.length ? ja / bodyText.length : 0,
      textLen: bodyText.length,
    };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 80) };
  } finally {
    clearTimeout(t);
  }
}
