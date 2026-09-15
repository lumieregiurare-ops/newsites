// Google トレンド（日本）の急上昇検索を取得する。
// キーワード・検索ボリューム・関連ニュースの見出しは Google が公開しているフィードの内容で、
// こちらでは分類と「新しく入ってきたか」の判定だけを加える。
import { fetchText, log, truncate } from "./util.mjs";
import { decodeEntities, stripTags } from "./xml.mjs";

const FEED = "https://trends.google.co.jp/trending/rss?geo=JP";

// 話題の理由をざっくり分ける。上から順に当てはめる
const CATEGORIES = [
  { id: "game", label: "ゲーム", re: /ゲーム|switch|playstation|\bps[45]\b|xbox|steam|任天堂|ポケモン|モンハン|ドラクエ|ff\d|ファイナルファンタジー|eスポーツ|アプリ|ガチャ|原神|フォートナイト|マイクラ|スプラトゥーン/i },
  { id: "sports", label: "スポーツ", re: /野球|サッカー|jリーグ|プロ野球|巨人|阪神|ソフトバンク|ドジャース|大谷|相撲|ゴルフ|テニス|オリンピック|wbc|マラソン|駅伝|バスケ|bリーグ|格闘技|ボクシング|f1|競馬|ラグビー/i },
  { id: "entame", label: "エンタメ", re: /ドラマ|映画|アニメ|声優|俳優|女優|歌手|アイドル|ライブ|コンサート|紅白|音楽|バンド|漫画|コミック|youtuber|配信者|vtuber|芸人|お笑い|テレビ|番組|放送/i },
  { id: "news", label: "ニュース", re: /地震|台風|大雨|火災|事故|事件|逮捕|選挙|政権|首相|大臣|株価|為替|円安|円高|値上げ|発表|会見|死去|訃報|裁判|コロナ|インフル/i },
  { id: "product", label: "新商品・サービス", re: /発売|新商品|新作|限定|コラボ|キャンペーン|セール|予約|オープン|開店|リニューアル|アップデート/i },
];

function classify(text) {
  for (const c of CATEGORIES) if (c.re.test(text)) return { id: c.id, label: c.label };
  return { id: "other", label: "その他" };
}

// 「200+」「1万+」などを比較できる数値にする
function trafficValue(s) {
  const m = (s || "").match(/([\d,.]+)\s*([万億]?)/);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, "")) || 0;
  return n * (m[2] === "万" ? 10000 : m[2] === "億" ? 100000000 : 1);
}

export async function fetchTrends({ limit = 20, cache = {} } = {}) {
  const xml = await fetchText(FEED, { timeoutMs: 20000 });
  const blocks = xml.split(/<item>/).slice(1);
  const now = new Date();
  const seenBefore = cache.seen || {};
  const items = [];

  for (const b of blocks.slice(0, limit)) {
    const title = decodeEntities((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
    if (!title) continue;
    const traffic = decodeEntities((b.match(/<ht:approx_traffic>([^<]*)<\/ht:approx_traffic>/) || [])[1] || "").trim();
    const picture = decodeEntities((b.match(/<ht:picture>([^<]*)<\/ht:picture>/) || [])[1] || "").trim();
    const pictureSource = decodeEntities((b.match(/<ht:picture_source>([^<]*)<\/ht:picture_source>/) || [])[1] || "").trim();
    const news = [...b.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)]
      .map((m) => ({
        title: truncate(stripTags(decodeEntities((m[1].match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/) || [])[1] || "")), 70),
        url: decodeEntities((m[1].match(/<ht:news_item_url>([^<]*)<\/ht:news_item_url>/) || [])[1] || "").trim(),
        source: decodeEntities((m[1].match(/<ht:news_item_source>([^<]*)<\/ht:news_item_source>/) || [])[1] || "").trim(),
      }))
      .filter((n) => n.title && n.url)
      .slice(0, 2);

    const cat = classify(`${title} ${news.map((n) => n.title).join(" ")}`);
    items.push({
      rank: items.length + 1,
      keyword: title,
      traffic,
      trafficValue: trafficValue(traffic),
      category: cat.id,
      categoryLabel: cat.label,
      image: /^https:\/\//.test(picture) ? picture : "",
      imageSource: pictureSource,
      news,
      // 前回の取得に無かったキーワードは「新登場」として印を付ける
      isNew: !seenBefore[title],
      url: `https://trends.google.co.jp/trends/explore?q=${encodeURIComponent(title)}&geo=JP`,
    });
  }

  // 次回の比較用に、直近 3 日分のキーワードを覚えておく
  const keep = {};
  const cutoff = now.getTime() - 3 * 86400000;
  for (const [k, v] of Object.entries(seenBefore)) if (new Date(v).getTime() > cutoff) keep[k] = v;
  for (const it of items) keep[it.keyword] = keep[it.keyword] || now.toISOString();
  cache.seen = keep;

  log(`trends: ${items.length} keywords (new ${items.filter((i) => i.isNew).length})`);
  return {
    updatedAt: now.toISOString(),
    source: "Google トレンド（日本）",
    sourceUrl: "https://trends.google.co.jp/trending?geo=JP",
    items,
  };
}
