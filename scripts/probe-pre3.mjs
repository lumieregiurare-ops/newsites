const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";
async function t(label, url) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: ac.signal });
    const b = await r.text();
    console.log(label, r.status, b.length, `${Date.now() - t0}ms`);
    return b;
  } catch (e) {
    console.log(label, "ERR", e.message, `${Date.now() - t0}ms`);
  } finally { clearTimeout(timer); }
}
await t("lookup ", "https://itunes.apple.com/lookup?id=6775403879&country=jp");
const b = await t("search ", "https://itunes.apple.com/search?term=%E3%83%9E%E3%83%93%E3%83%8E%E3%82%AE&country=jp&media=software&limit=2");
if (b) { const j = JSON.parse(b); console.log("  results:", (j.results || []).map((r) => `${r.trackName} rel=${(r.releaseDate||"").slice(0,10)}`).join(" | ")); }
