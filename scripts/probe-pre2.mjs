import { fetchJson } from "./lib/util.mjs";
for (const term of ["マビノギモバイル", "バンドリ アワーノーツ", "勝利の女神 NIKKE"]) {
  try {
    const j = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=jp&media=software&entity=software&limit=3&lang=ja_jp`, { timeoutMs: 15000 });
    console.log(`search "${term}": ${j.resultCount}`);
    for (const r of j.results || []) {
      const future = new Date(r.releaseDate).getTime() > Date.now();
      console.log("  -", (r.trackName || "").slice(0, 24).padEnd(26), "| rel:", (r.releaseDate || "").slice(0, 10), future ? "★予約中" : "        ", "|", (r.genres || []).slice(0, 2).join("/"), "|", (r.sellerUrl || "").slice(0, 40));
    }
  } catch (e) { console.log("ERR", term, e.message); }
}
