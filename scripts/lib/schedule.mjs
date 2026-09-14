// リリーススケジュール / 事前登録受付中 のデータ生成
//  - Nintendo: 公式サイトの検索 API（発売予定・予約受付中）
//  - Steam: ストアの「人気の近日登場」
//  - ニュース: 収集済み記事の見出しから「M月D日発売」「事前登録開始」などを抽出
import { fetchText, fetchJson, log, truncate, idOf } from "./util.mjs";
import { decodeEntities } from "./xml.mjs";

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// ---------- Nintendo ----------
const NINTENDO_HARD = { "1_HAC": "switch", "05_BEE": "switch2" };

export async function fetchNintendo({ limit = 300 } = {}) {
  const url =
    "https://search.nintendo.jp/nintendo_soft/search.json?opt_sshow=1" +
    "&opt_ssitu[]=unreleased&opt_ssitu[]=preorder&sort=sodate%20asc%2Cscore&limit=" + limit;
  const j = await fetchJson(url);
  const byTitle = new Map();
  for (const it of j.result?.items || []) {
    const platform = NINTENDO_HARD[it.hard];
    if (!platform) continue;
    const key = it.title.trim().toLowerCase();
    let rec = byTitle.get(key);
    if (!rec) {
      const parsed = parseNintendoDate(it.sdate);
      rec = {
        id: idOf(`nintendo:${key}`),
        title: it.title.trim(),
        ...parsed,
        platforms: [],
        url: it.nsuid ? `https://store-jp.nintendo.com/item/software/D${it.nsuid}` : `https://www.nintendo.com/jp/search/#q=${encodeURIComponent(it.title)}`,
        image: it.iurl ? `https://img-eshop.cdn.nintendo.net/i/${it.iurl}.jpg` : "",
        maker: it.maker || "",
        genre: (it.genre || []).slice(0, 3),
        price: it.price ?? it.dprice ?? null,
        status: it.ssitu === "preorder" ? "予約受付中" : "",
        priority: it.ssitu === "preorder" ? 1 : 2, // トップページの「注目」選定用（小さいほど優先）
        source: "Nintendo",
        sourceUrl: "https://www.nintendo.com/jp/software/schedule/index.html",
      };
      byTitle.set(key, rec);
    }
    if (!rec.platforms.includes(platform)) rec.platforms.push(platform);
  }
  return [...byTitle.values()];
}

function parseNintendoDate(sdate) {
  if (!sdate || sdate === "未定") return { date: null, dateText: "発売日未定", sortKey: "9999-99-99" };
  let m = sdate.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (m) {
    const iso = isoDate(m[1], m[2], m[3]);
    return { date: iso, dateText: `${m[1]}年${Number(m[2])}月${Number(m[3])}日`, sortKey: iso };
  }
  m = sdate.match(/^(\d{4})\.(\d{1,2})$/);
  if (m) return { date: null, dateText: `${m[1]}年${Number(m[2])}月`, sortKey: `${m[1]}-${pad(m[2])}-32` };
  m = sdate.match(/^(\d{4})/);
  if (m) return { date: null, dateText: sdate.replace(/\./g, "年") , sortKey: `${m[1]}-13-00` };
  return { date: null, dateText: sdate, sortKey: "9999-99-98" };
}

// ---------- Steam ----------
export async function fetchSteam({ count = 100 } = {}) {
  const url = `https://store.steampowered.com/search/results/?query&start=0&count=${count}&filter=popularcomingsoon&infinite=1&cc=jp&l=japanese`;
  const j = await fetchJson(url);
  const blocks = (j.results_html || "").split(/<a href="https:\/\/store\.steampowered\.com\/app\//).slice(1);
  const out = [];
  for (const b of blocks) {
    const appid = b.match(/^(\d+)/)?.[1];
    const title = decodeEntities(b.match(/<span class="title">([^<]+)</)?.[1] || "").trim();
    if (!appid || !title) continue;
    const rel = decodeEntities(b.match(/search_released[^>]*>\s*([^<]*)</)?.[1] || "").trim();
    out.push({
      id: idOf(`steam:${appid}`),
      title,
      ...parseJaDateText(rel),
      priority: 3 + out.length / 1000, // Steam の人気順を保持
      platforms: ["pc"],
      url: `https://store.steampowered.com/app/${appid}/`,
      image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
      maker: "",
      source: "Steam",
      sourceUrl: "https://store.steampowered.com/explore/upcoming/",
    });
  }
  return out;
}

// "2026年9月14日" / "2026年10月" / "2026年第4四半期" / "近日登場" などを揃える
export function parseJaDateText(text, { baseYear } = {}) {
  const t = (text || "").trim();
  let m = t.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) {
    const iso = isoDate(m[1], m[2], m[3]);
    return { date: iso, dateText: `${m[1]}年${Number(m[2])}月${Number(m[3])}日`, sortKey: iso };
  }
  m = t.match(/(\d{4})年\s*第([1-4])四半期/) || t.match(/Q([1-4])\s*(\d{4})/);
  if (m) {
    const year = m[1].length === 4 ? m[1] : m[2];
    const q = Number(m[1].length === 4 ? m[2] : m[1]);
    return { date: null, dateText: `${year}年第${q}四半期`, sortKey: `${year}-${pad(q * 3)}-31` };
  }
  m = t.match(/(\d{4})年\s*(\d{1,2})月/);
  if (m) return { date: null, dateText: `${m[1]}年${Number(m[2])}月`, sortKey: `${m[1]}-${pad(m[2])}-32` };
  m = t.match(/(\d{4})年\s*(初頭|前半|春|夏|秋|冬|後半|内|中)/);
  if (m) {
    const season = { 初頭: "02", 春: "04", 前半: "06", 夏: "07", 秋: "10", 冬: "12", 後半: "12", 内: "12", 中: "12" }[m[2]];
    return { date: null, dateText: `${m[1]}年${m[2]}`, sortKey: `${m[1]}-${season}-33` };
  }
  m = t.match(/^(\d{4})年?$/);
  if (m) return { date: null, dateText: `${m[1]}年`, sortKey: `${m[1]}-13-00` };
  if (/近日|coming soon|tba|未定/i.test(t) || !t) return { date: null, dateText: t || "時期未定", sortKey: "9999-99-99" };
  return { date: null, dateText: t, sortKey: "9999-99-98" };
}

// ---------- ニュース見出しから ----------
const RELEASE_WORD = /発売|配信(開始|決定|予定)|リリース|サービス(開始|イン)|ローンチ|正式(公開|オープン)|登場/;
const EVENT_ONLY = /開催|放送|ライブ|上映|イベント|大会|セール|キャンペーン|アップデート|コラボ|生放送|出展/;
// ゲーム本体ではないもの（グッズ・番組・書籍など）の発売は除く
const NON_GAME = /グッズ|番組|生放送|フィギュア|くじ|サウンドトラック|書籍|コミックス|映画|舞台|ぬいぐるみ|Tシャツ|アクリル|カフェ|コラボ商品|プライズ/;
const PREREG_START = /事前登録.{0,12}(開始|受付|スタート|実施|募集|中)|(開始|受付|スタート).{0,6}事前登録/;

function nearestFutureDate(month, day, now) {
  const y = now.getFullYear();
  for (const year of [y, y + 1]) {
    const d = new Date(year, month - 1, day);
    if (d.getTime() >= now.getTime() - 14 * 86400000) return isoDate(year, month, day);
  }
  return isoDate(y + 1, month, day);
}

export function extractReleaseFromHeadline(headline, now = new Date()) {
  if (!headline || !RELEASE_WORD.test(headline)) return null;
  if (NON_GAME.test(headline)) return null;
  // イベント系だけの見出しは除外（「発売」などの語が無い場合）
  if (EVENT_ONLY.test(headline) && !/発売|配信開始|リリース|サービス開始|ローンチ/.test(headline)) return null;

  let m = headline.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return parseJaDateText(m[0]);
  m = headline.match(/(?<!\d)(\d{1,2})月\s*(\d{1,2})日/);
  if (m) {
    const iso = nearestFutureDate(Number(m[1]), Number(m[2]), now);
    return { date: iso, dateText: `${iso.slice(0, 4)}年${Number(m[1])}月${Number(m[2])}日`, sortKey: iso };
  }
  m = headline.match(/(\d{4})年\s*(第[1-4]四半期|初頭|前半|春|夏|秋|冬|後半|内|中|\d{1,2}月)/);
  if (m) return parseJaDateText(m[0]);
  m = headline.match(/(?<!\d)(\d{1,2})月(?:に|中|上旬|中旬|下旬|配信|発売|リリース)/);
  if (m) {
    const month = Number(m[1]);
    const year = month >= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() + 1;
    return { date: null, dateText: `${year}年${month}月`, sortKey: `${year}-${pad(month)}-32` };
  }
  return null;
}

export function extractPreregFromHeadline(headline) {
  if (!headline || !/事前登録/.test(headline)) return null;
  if (!PREREG_START.test(headline)) return null;
  const rel = headline.match(/(\d{4}年)?\s*(\d{1,2}月)\s*(\d{1,2}日)?\s*(に|より|から)?\s*(配信|リリース|サービス開始|正式サービス|ローンチ)/);
  return { releaseText: rel ? rel[0].replace(/\s+/g, "") : "" };
}

// ---------- 統合 ----------
export async function buildSchedule(config, items, { platformDetector } = {}) {
  const cfg = config.releases || {};
  const now = new Date();
  const todayIso = isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const horizon = new Date(now.getTime() + (cfg.daysAhead ?? 120) * 86400000);
  const horizonIso = isoDate(horizon.getFullYear(), horizon.getMonth() + 1, horizon.getDate());

  const releases = [];
  const stats = {};

  if (cfg.nintendo !== false) {
    try {
      const list = await fetchNintendo({ limit: cfg.nintendoLimit ?? 300 });
      releases.push(...list);
      stats.nintendo = list.length;
    } catch (e) {
      stats.nintendo = `error: ${e.message}`;
      log("schedule nintendo failed:", e.message);
    }
  }
  if (cfg.steam !== false) {
    try {
      const list = await fetchSteam({ count: cfg.steamCount ?? 100 });
      releases.push(...list);
      stats.steam = list.length;
    } catch (e) {
      stats.steam = `error: ${e.message}`;
      log("schedule steam failed:", e.message);
    }
  }

  // ニュース由来の発売情報 / 事前登録
  const prereg = [];
  let fromNews = 0;
  for (const it of items) {
    if (it.sourceKind !== "news" || !it.headline) continue;
    const platforms = platformDetector ? platformDetector(it) : it.platforms || [];
    const rel = extractReleaseFromHeadline(it.headline, now);
    if (rel && rel.sortKey !== "9999-99-99") {
      releases.push({
        id: idOf(`news:${it.url}`),
        title: it.title,
        ...rel,
        priority: 0, // メディアが報じたタイトルを最優先
        platforms,
        url: it.url,
        image: it.image || "",
        maker: "",
        headline: truncate(it.headline, 90),
        source: it.source,
        sourceUrl: it.sources?.[0]?.url || "",
      });
      fromNews++;
    }
    const pre = extractPreregFromHeadline(it.headline);
    if (pre) {
      prereg.push({
        id: it.id,
        title: it.title,
        url: it.url,
        image: it.image || "",
        platforms: platforms.length ? platforms : ["mobile"],
        startedAt: it.publishedAt,
        releaseText: pre.releaseText,
        headline: truncate(it.headline, 90),
        description: it.description || "",
        source: it.source,
        sourceUrl: it.sources?.[0]?.url || "",
      });
    }
  }
  stats.news = fromNews;
  stats.prereg = prereg.length;

  // 期間内（今日〜daysAhead）の確定日付 + 時期のみ判明しているもの（先頭 N 件）
  const dated = releases
    .filter((r) => r.date && r.date >= todayIso && r.date <= horizonIso)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title, "ja"));
  const undated = releases
    .filter((r) => !r.date && r.sortKey < "9999" && r.sortKey.slice(0, 7) >= todayIso.slice(0, 7))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(0, cfg.maxUndated ?? 40);

  // 同名タイトルの重複（Nintendo + ニュースなど）はプラットフォームを統合
  const merged = new Map();
  for (const r of [...dated, ...undated]) {
    const key = `${r.title.toLowerCase().replace(/\s+/g, "")}|${r.sortKey}`;
    const prev = merged.get(key);
    if (prev) {
      for (const p of r.platforms) if (!prev.platforms.includes(p)) prev.platforms.push(p);
      if (!prev.image && r.image) prev.image = r.image;
      if (!prev.maker && r.maker) prev.maker = r.maker;
      prev.priority = Math.min(prev.priority ?? 9, r.priority ?? 9);
      continue;
    }
    merged.set(key, { ...r });
  }

  prereg.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  return {
    updatedAt: now.toISOString(),
    daysAhead: cfg.daysAhead ?? 120,
    stats,
    releases: [...merged.values()],
    prereg,
  };
}
