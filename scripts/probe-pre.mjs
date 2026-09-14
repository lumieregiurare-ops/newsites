import { fetchJson, fetchText } from "./lib/util.mjs";
import { stripTags, decodeEntities } from "./lib/xml.mjs";
// (1) iTunes 検索 API でタイトル名から予約中アプリを引けるか
for (const term of ["マビノギモバイル", "バンドリ アワーノーツ", "勝利の女神 NIKKE", "シャングリラ・フロンティア"]) {
  const j = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=jp&media=software&entity=software&limit=3&lang=ja_jp`);
  console.log(`\nsearch "${term}": ${j.resultCount}`);
  for (const r of j.results || []) {
    const future = new Date(r.releaseDate).getTime() > Date.now();
    console.log("  -", r.trackName?.slice(0, 26).padEnd(28), "| rel:", r.releaseDate?.slice(0, 10), future ? "★予約中" : "", "|", (r.genres || []).slice(0, 2).join("/"), "|", (r.sellerUrl || "").slice(0, 40));
  }
}
// (2) 記事本文に「事前登録」がどう書かれているか（4Gamer / Inside / 電ファミ）
const arts = [
  "https://www.4gamer.net/rss/index.xml",
  "https://www.inside-games.jp/rss20/mobile.rdf",
];
import { parseFeed } from "./lib/xml.mjs";
for (const feed of arts) {
  const items = parseFeed(await fetchText(feed));
  console.log(`\n=== ${feed} (${items.length}) ===`);
  let n = 0;
  for (const it of items) {
    if (n >= 4) break;
    const html = await fetchText(it.link);
    const text = stripTags(html.replace(/<head[\s\S]*?<\/head>/i, ""));
    if (!/事前登録|予約注文|事前予約/.test(text)) continue;
    n++;
    const i = text.search(/事前登録|予約注文|事前予約/);
    console.log("--", it.title.slice(0, 46));
    console.log("   title-hit:", /事前登録|予約注文/.test(it.title), "| ctx:", text.slice(Math.max(0, i - 60), i + 90).replace(/\s+/g, " "));
    const nums = text.match(/事前登録者?数?[^\d]{0,6}(\d+[万億]?)人/);
    const reward = text.match(/事前登録特典[：:「【]?([^」】\n]{0,40})/);
    console.log("   count:", nums?.[0] || "-", "| reward:", reward?.[1]?.slice(0, 30) || "-");
  }
}
