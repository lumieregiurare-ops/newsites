// リリーススケジュール / 事前登録受付中 のデータ生成
//  - Nintendo: 公式サイトの検索 API（発売予定・予約受付中）
//  - Steam: ストアの「人気の近日登場」
//  - ニュース: 収集済み記事の見出しから「M月D日発売」「事前登録開始」などを抽出
import { fetchText, fetchJson, log, truncate, idOf } from "./util.mjs";
import { decodeEntities } from "./xml.mjs";
import { searchTitles, lookupIds, searchTerm } from "./appstore.mjs";

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
  // 「特別番組が◯月◯日より配信」のような、作品そのものの配信ではない見出しを弾く
  if (NOT_A_RELEASE.test(headline)) return null;
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

// App Store の予約注文は発売日未定のとき 12/31 などの仮日付が入るため、確定日として扱わない
export function appStoreReleaseText(iso) {
  if (!iso) return "";
  // 配信開始日時は UTC で入っているので、日本時間の「日付」に直して表示する
  // （収集は GitHub Actions の UTC 環境でも走るため、実行環境の時差に影響されないようにする）
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 3600000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  // 12/31 や 1/1、1 年以上先の日付は「未定」を埋めるための仮日付なので日付として扱わない
  const isPlaceholder = (m === 12 && day === 31) || (m === 1 && day === 1) || d.getTime() - Date.now() > 365 * 86400000;
  if (isPlaceholder) return "";
  return `${y}年${m}月${day}日`;
}

// 記事の見出しからだけ配信日を読み取る。
// 本文全体を対象にすると、関連記事や別タイトルの日付を拾ってしまうため使わない。
const NOT_A_RELEASE = /番組|放送|生配信|特番|発表会|上映|ライブ|イベント|先行プレイ|試遊|配信者|ストリーマー|公開収録|カウントダウン/;
const RELEASE_VERB = "(?:正式)?(?:配信|リリース|サービス(?:開始|イン)|ローンチ|発売|オープン)";

export function releaseTextFromHeadline(headline) {
  if (!headline) return "";
  // 番組や生放送の日時を配信日と取り違えないようにする
  if (NOT_A_RELEASE.test(headline)) return "";

  // 「9月24日リリース」「2027年4月22日に発売」（直後に時刻が来るものは除く）
  let m = headline.match(new RegExp(`(\\d{4}年)?\\s*(\\d{1,2})月\\s*(\\d{1,2})日(?!\\s*\\d{1,2}\\s*[:：時])\\s*(?:に|より|から)?\\s*${RELEASE_VERB}`));
  if (m) return m[0].replace(/\s+/g, "");
  // 「2027年春リリース」「2026年内に配信」「2026年第4四半期に配信」
  m = headline.match(new RegExp(`\\d{4}年\\s*(?:内|初頭|前半|後半|春|夏|秋|冬|第[1-4]四半期|\\d{1,2}月)?\\s*(?:に|より|から)?\\s*${RELEASE_VERB}`));
  if (m) return m[0].replace(/\s+/g, "");
  // 「正式サービス開始日が9月14日に決定」「配信日は10月2日」
  m = headline.match(/(?:正式)?(?:配信|リリース|発売|サービス開始|サービスイン)日(?:が|は|:|：)?\s*((?:\d{4}年)?\s*\d{1,2}月\s*\d{1,2}日)/);
  if (m) return m[1].replace(/\s+/g, "") + "配信";
  return "";
}

// 事前登録の判定。配信日は見出し由来のものだけを使い、無ければ App Store の表記に頼る
export function extractPrereg(item) {
  const a = item.article;
  const headlineRelease = releaseTextFromHeadline(item.headline || "");
  if (a) {
    if (a.preregEnded) return null;
    if (a.prereg) {
      return { releaseText: headlineRelease, releaseSource: headlineRelease ? "news" : "", count: a.count || "", reward: a.reward || "" };
    }
    return null;
  }
  const headline = item.headline;
  if (!headline || !/事前登録/.test(headline) || !PREREG_START.test(headline)) return null;
  return { releaseText: headlineRelease, releaseSource: headlineRelease ? "news" : "", count: "", reward: "" };
}

// ---------- 統合 ----------
export async function buildSchedule(config, items, { platformDetector, cache = {} } = {}) {
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
    const pre = extractPrereg(it);
    // 配信日がすでに過ぎているものは「事前登録」から外す（配信開始済み）
    if (pre && pre.releaseText) {
      const parsed = parseJaDateText(pre.releaseText.replace(/(に|より|から)?(配信|リリース|正式サービス開始|サービス開始|ローンチ|発売).*$/, ""), { now });
      if (parsed.date && parsed.date <= todayIso) continue;
      if (!parsed.date && /^\d{1,2}月\d{1,2}日/.test(pre.releaseText)) {
        const m = pre.releaseText.match(/(\d{1,2})月(\d{1,2})日/);
        const guess = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
        const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (guess <= today0 && now.getMonth() + 1 - Number(m[1]) < 6) continue;
      }
    }
    if (pre) {
      prereg.push({
        id: it.id,
        title: it.title,
        url: it.url,
        image: it.image || "",
        platforms: platforms.length ? platforms : ["mobile"],
        startedAt: it.publishedAt,
        releaseText: pre.releaseText,
        releaseSource: pre.releaseSource || "",
        count: pre.count,
        reward: pre.reward,
        headline: truncate(it.headline, 90),
        description: it.description || "",
        source: it.source,
        sourceUrl: it.sources?.[0]?.url || "",
        appleId: it.article?.ios || "",
      });
    }
  }
  stats.news = fromNews;

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

  // ---------- App Store で予約注文中のタイトルを確認する ----------
  // ニュースに出たスマホゲーム名を検索し、releaseDate が未来なら「予約受付中」として扱う
  const appCfg = cfg.appstoreMatch || {};
  const appCache = (cache.appstoreSearch = cache.appstoreSearch || {});
  let appStats = { searched: 0, matched: 0, preorder: 0 };
  if (appCfg.enabled !== false) {
    const candidates = [];
    const seenTitle = new Set();
    for (const it of items) {
      if (it.sourceKind !== "news") continue;
      const mobile = (platformDetector ? platformDetector(it) : it.platforms || []).includes("mobile");
      const preregLike = it.article?.prereg || /事前登録|予約注文/.test(`${it.title} ${it.headline || ""}`);
      if (!mobile && !preregLike) continue;
      const key = searchTerm(it.title);
      if (!key || seenTitle.has(key)) continue;
      seenTitle.add(key);
      candidates.push(it);
    }
    const found = await searchTitles(
      candidates.map((c) => c.title),
      { cache: appCache, delayMs: appCfg.delayMs ?? 3000, max: appCfg.maxPerRun ?? 30 }
    );
    appStats.searched = candidates.length;
    appStats.matched = found.size;

    // 予約中のものは事前登録リストへ（既に載っていれば情報を補強）
    const byTitle = new Map(prereg.map((p) => [p.title, p]));
    for (const it of candidates) {
      const app = found.get(it.title);
      if (!app) continue;
      const existing = byTitle.get(it.title);
      if (existing) {
        existing.appStore = { url: app.storeUrl, preorder: app.isPreorder, releaseDate: app.releaseDate };
        if (!existing.image && app.image) existing.image = app.image;
        // ストアの配信予定日は開発者が随時更新する最新値なので、記事見出しの発表日より優先する
        const t = app.isPreorder ? appStoreReleaseText(app.releaseDate) : "";
        if (t) {
          if (existing.releaseText && existing.releaseText !== t) existing.announcedText = existing.releaseText;
          existing.releaseText = t;
          existing.releaseSource = "appstore";
        }
        continue;
      }
      if (!app.isPreorder) continue;
      appStats.preorder++;
      const platforms = platformDetector ? platformDetector(it) : it.platforms || [];
      prereg.push({
        id: it.id,
        title: it.title,
        url: it.url,
        image: it.image || app.image,
        platforms: platforms.length ? platforms : ["mobile"],
        startedAt: it.publishedAt,
        releaseText: appStoreReleaseText(app.releaseDate),
        releaseSource: appStoreReleaseText(app.releaseDate) ? "appstore" : "",
        count: "",
        reward: "",
        headline: truncate(it.headline || "", 90),
        description: it.description || "",
        source: it.source,
        sourceUrl: it.sources?.[0]?.url || "",
        appStore: { url: app.storeUrl, preorder: true, releaseDate: app.releaseDate },
      });
    }
  }
  stats.appstore = appStats;
  stats.prereg = prereg.length;

  prereg.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  // ニュース見出し由来の発売日も、App Store に確定した配信予定日があればそちらに合わせる
  // （発表後に日程が変わったケースで、スケジュールと事前登録の日付が食い違わないようにする）
  const storeDates = new Map();
  for (const p of prereg) {
    if (p.appStore?.preorder && p.releaseSource === "appstore" && p.releaseText) {
      storeDates.set(p.title.toLowerCase().replace(/\s+/g, ""), p.releaseText);
    }
  }
  for (const r of merged.values()) {
    const t = storeDates.get(r.title.toLowerCase().replace(/\s+/g, ""));
    if (!t || r.source === "Nintendo" || r.source === "Steam") continue;
    const parsed = parseJaDateText(t);
    if (!parsed.date || parsed.dateText === r.dateText) continue;
    r.announcedText = r.dateText;
    r.date = parsed.date;
    r.dateText = parsed.dateText;
    r.sortKey = parsed.sortKey;
    r.dateSource = "appstore";
  }
  const list = [...merged.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title, "ja"));

  // ---------- 変更履歴 ----------
  const changes = trackChanges({ releases: list, prereg }, cache, now, cfg.historyDays ?? 30);

  return {
    updatedAt: now.toISOString(),
    daysAhead: cfg.daysAhead ?? 120,
    stats,
    releases: list,
    prereg,
    changes,
  };
}

// タイトルごとに「発売日」「事前登録」の状態を覚えておき、変化した項目を履歴として返す
const CHANGE_LABELS = {
  new: "新規",
  date_fixed: "発売日決定",
  delayed: "発売延期",
  moved_up: "発売日前倒し",
  date_changed: "発売日変更",
  prereg_start: "事前登録開始",
  prereg_end: "事前登録終了",
  released: "配信開始",
};

export function trackChanges(data, cache, now, historyDays) {
  const known = (cache.titles = cache.titles || {});
  const log = (cache.changeLog = cache.changeLog || []);
  const nowIso = now.toISOString();
  const push = (type, entry, extra = {}) =>
    log.push({
      at: nowIso,
      type,
      label: CHANGE_LABELS[type] || type,
      title: entry.title,
      url: entry.url,
      image: entry.image || "",
      platforms: entry.platforms || [],
      ...extra,
    });

  // 同じタイトルが複数の情報源（Nintendo と Steam など）で別項目になっていることがあるので、
  // 追跡は「タイトルごとに最も信頼できる 1 件」に絞る。そうしないと情報源の差が毎回「変更」になる
  const primary = new Map();
  for (const r of data.releases) {
    const key = r.title.toLowerCase().replace(/\s+/g, "");
    const cur = primary.get(key);
    if (!cur || (r.priority ?? 9) < (cur.priority ?? 9)) primary.set(key, r);
  }

  for (const [key, r] of primary) {
    const prev = known[key];
    if (!prev) {
      known[key] = { title: r.title, dateText: r.dateText, date: r.date, sortKey: r.sortKey, prereg: false, firstSeen: nowIso };
      // 初回実行時に全件が「新規」になるのを避ける（履歴が空のときは記録しない）
      // Steam の人気一覧は入れ替わりが激しいので「新規」としては扱わない
      if (cache.initialized && (r.priority ?? 9) <= 2) push("new", r, { to: r.dateText });
      continue;
    }
    if (prev.dateText === r.dateText) continue;

    const wasDate = prev.date;
    const nowDate = r.date;
    const diffDays = wasDate && nowDate ? Math.round((new Date(nowDate) - new Date(wasDate)) / 86400000) : null;
    let type = null;
    if (!wasDate && nowDate) type = "date_fixed";
    else if (diffDays !== null && Math.abs(diffDays) >= 2) type = diffDays > 0 ? "delayed" : "moved_up";
    else if (diffDays === null && prev.sortKey !== r.sortKey) type = "date_changed";
    // ストアの表記ゆれ（1 日程度のずれ）は記録しないが、状態は更新しておく
    if (type && (r.priority ?? 9) <= 2) push(type, r, { from: prev.dateText, to: r.dateText });
    prev.dateText = r.dateText;
    prev.date = r.date;
    prev.sortKey = r.sortKey;
  }

  for (const p of data.prereg) {
    const key = p.title.toLowerCase().replace(/\s+/g, "");
    const prev = (known[key] = known[key] || { title: p.title, prereg: false, firstSeen: nowIso });
    if (!prev.prereg) {
      prev.prereg = true;
      if (cache.initialized) push("prereg_start", p, { to: p.releaseText || "" });
    }
  }
  const preregTitles = new Set(data.prereg.map((p) => p.title.toLowerCase().replace(/\s+/g, "")));
  for (const [key, v] of Object.entries(known)) {
    if (v.prereg && !preregTitles.has(key)) v.prereg = false;
  }

  cache.initialized = true;
  const cutoff = now.getTime() - historyDays * 86400000;
  cache.changeLog = log.filter((c) => new Date(c.at).getTime() >= cutoff).slice(-400);

  // 掲載対象から外れたタイトル（除外ルールの変更などで消えたもの）の履歴は表示しない。
  // 「事前登録開始」は、いま事前登録を受け付けているタイトルにだけ出す（配信済みなら消える）
  const key = (t) => (t || "").toLowerCase().replace(/\s+/g, "");
  const live = new Set([...data.releases, ...data.prereg].map((x) => key(x.title)));
  const preregByKey = new Map(data.prereg.map((p) => [key(p.title), p]));
  return [...cache.changeLog]
    .reverse()
    .filter((c) => (c.type === "prereg_start" ? preregByKey.has(key(c.title)) : live.has(key(c.title))))
    .map((c) => {
      // 「事前登録開始」の配信日は記録時点の値ではなく、いま分かっている値（出典付き）を出す。
      // 記録当時の抽出ミスが履歴に残り続けないようにするため
      if (c.type !== "prereg_start") return c;
      const p = preregByKey.get(key(c.title));
      const to = p.releaseText ? (p.releaseSource === "appstore" ? `App Store ${p.releaseText}` : p.releaseText) : "";
      return { ...c, to };
    })
    .slice(0, 60);
}
