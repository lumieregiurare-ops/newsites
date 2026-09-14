// 事前登録の「一覧ページ」からタイトル名だけを拾う（発見用）。
// 一覧の中身（順位・日付・特典など）はそのサイトの編集物なので転載せず、
// 拾ったタイトルは App Store の予約状況や既存のニュース項目で裏取りしてから掲載する。
import { UA, log } from "./util.mjs";
import { stripTags, decodeEntities } from "./xml.mjs";

const LISTS = {
  game8: {
    name: "Game8",
    url: "https://game8.jp/preregistration/139504",
    parse(html) {
      const out = [];
      for (const m of html.matchAll(/<a[^>]+href=['"]?(https:\/\/game8\.jp\/preregistration\/(\d+))['"]?[^>]*>([\s\S]{0,300}?)<\/a>/g)) {
        const text = decodeEntities(stripTags(m[3])).replace(/\s+/g, " ").trim();
        if (!text || /^\d+$/.test(text) || /ランキング|くじ|一覧|カレンダー|ジャンル|もっと見る|おすすめ|配信予定|配信済/.test(text)) continue;
        out.push({ title: text, sourceUrl: m[1] });
      }
      return out;
    },
  },
};

export async function fetchPreregTitles(cfg = {}) {
  const enabled = Object.keys(LISTS).filter((k) => cfg[k] !== false);
  const seen = new Map();
  for (const key of enabled) {
    const l = LISTS[key];
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const r = await fetch(l.url, { headers: { "user-agent": UA, accept: "text/html", "accept-language": "ja" }, signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = new TextDecoder(l.encoding || "utf-8").decode(await r.arrayBuffer());
      let n = 0;
      for (const e of l.parse(html)) {
        const k = e.title.toLowerCase().replace(/\s+/g, "");
        if (seen.has(k)) continue;
        seen.set(k, { title: e.title, source: l.name, sourceUrl: e.sourceUrl, listUrl: l.url });
        n++;
      }
      log(`prereg list ${l.name}: ${n} titles`);
    } catch (e) {
      log(`prereg list ${l.name} failed: ${e.message}`);
    }
  }
  return [...seen.values()];
}
