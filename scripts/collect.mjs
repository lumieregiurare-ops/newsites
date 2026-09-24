// 新着サイト収集スクリプト: フィード取得 → 除外フィルタ → カテゴリ分類 → OGP 取得 → docs/data/sites.json
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJson, writeJson, idOf, hostOf, cleanUrl, log, pool, truncate } from "./lib/util.mjs";
import { SOURCES } from "./lib/sources.mjs";
import { createBlockChecker } from "./lib/filter.mjs";
import { createCategorizer } from "./lib/categorize.mjs";
import { fetchMeta } from "./lib/meta.mjs";
import { buildSchedule, fetchScheduleFeeds } from "./lib/schedule.mjs";
import { toSiteRoot, createSiteFilter, canonicalKey } from "./lib/siteurl.mjs";
import { fetchPreregTitles } from "./lib/preregLists.mjs";
import { fetchNoteArticles } from "./lib/note.mjs";
import { fetchTrends } from "./lib/trends.mjs";
import { buildRankings } from "./lib/rankings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "docs", "radar", "data", "sites.json"); // 公開用（docs/ がサイトルート、radar/ が下層）
const RUN_FILE = join(ROOT, "data", "last-run.json"); // 非公開の実行ログ
const CACHE_FILE = join(ROOT, "data", "source-cache.json");

const started = Date.now();
const config = await readJson(join(ROOT, "config.json"));

// 収集元のどこかで接続が固まっても、全体が止まり続けないようにする（通常は 1〜3 分で終わる）
const WATCHDOG_MIN = config.watchdogMinutes ?? 20;
setTimeout(() => {
  console.error(`[watchdog] ${WATCHDOG_MIN} 分を超えたため中断します`);
  process.exit(2);
}, WATCHDOG_MIN * 60 * 1000).unref();

// フェーズごとの所要時間を測って last-run.json に残す（どこで時間を使っているかを見るため）
const timings = {};
async function phase(name, fn) {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    timings[name] = Math.round((Date.now() - t) / 100) / 10;
    log(`[time] ${name}: ${timings[name]}s`);
  }
}
// 内部状態（state.json）を優先し、無ければ公開 JSON / 旧配置から読み込む
const existing =
  (await readJson(join(ROOT, "data", "state.json"), null)) ||
  (await readJson(DATA_FILE, null)) ||
  (await readJson(join(ROOT, "data", "sites.json"), { items: [] }));
// 旧バージョンのスクリーンショット参照は破棄し、OGP で取り直す
for (const it of existing.items) {
  if (/^shots\//.test(it.image || "")) {
    it.image = "";
    it.metaAttempts = 0;
  }
  if (it.imageSource === "gallery" || it.imageSource === "remote") it.image = "";
  delete it.imageSource;
  delete it.imageAttempts;
  delete it.imageError;
  delete it.noScreenshot;
  if (!it.sourceKind) {
    it.sourceKind = /4Gamer|Game\*Spark|Inside|GameBusiness|電ファミ/.test(it.source)
      ? "news"
      : /Hacker News|Product Hunt|Launching Next|PitchWall|itch\.io/.test(it.source)
        ? "launch"
        : "gallery";
  }
}
const isBlocked = createBlockChecker(config.blocklist || {});
const categorizer = createCategorizer(config);
const now = new Date();
const nowIso = now.toISOString();

// 国内 / 海外 の判定（収集元の申告 or .jp ドメイン。OGP 取得時にページ言語で補完される）
function regionOf(url, declared) {
  const host = hostOf(url).toLowerCase();
  if (declared === "jp" || /\.jp$/.test(host)) return "jp";
  return "global";
}

// 説明文の方針: サイト自身の og:description を優先。
// なければ、ローンチ系は投稿者のタグライン、ニュース系は記事見出し、ギャラリー系は載せない（レビュー文の転載を避ける）
function fallbackDescription(r) {
  if (r.sourceKind === "gallery") return "";
  return r.description || "";
}

// 収集元が付けた短い見出し（記事タイトル・タグライン）。分類の手がかりとカードの補足表示に使う
function headlineOf(r) {
  return r.sourceKind === "gallery" ? "" : r.description || "";
}

// ゲーム特化: ニュース系と Product Hunt の games カテゴリはそのまま、他はゲーム関連キーワードに当たるものだけ残す
const focusCfg = config.focus || {};
const focusRes = (focusCfg.keywords || []).map((k) => new RegExp(k, "i"));
function inFocus(it) {
  if (!focusCfg.enabled) return true;
  if (it.sourceKind === "news") return true;
  if ((it.phCategories || []).includes("games")) return true;
  const text = `${it.title || ""} ${it.headline || ""} ${it.description || ""} ${(it.tags || []).join(" ")}`;
  return focusRes.some((re) => re.test(text));
}

// ---------- 0. 収集結果に依存しない取得を先に走らせる ----------
// note の記事・ランキング・事前登録一覧はフィードの収集結果と関係がないので、
// 待たせずにここで始めておき、必要になった場所で受け取る（直列に並べると 1 回の収集で 10 秒近く損をする）
const settle = (p) => Promise.resolve(p).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
const siteMeta = await readJson(join(ROOT, "docs", "data", "site.json"), {});
const rankCache = await readJson(join(ROOT, "data", "rankings-state.json"), {});
const notePromise = settle(
  siteMeta.note ? phase("note", () => fetchNoteArticles(siteMeta.note, { limit: config.note?.limit ?? 12 })) : null
);
const rankingsPromise = settle(
  config.rankings?.enabled === false ? null : phase("rankings", () => buildRankings(config, { cache: rankCache }))
);
const preregListsPromise = settle(
  config.releases?.enabled === false || config.releases?.preregLists?.enabled === false
    ? []
    : phase("preregLists", () => fetchPreregTitles(config.releases?.preregLists || {}))
);
const scheduleFeedsPromise =
  config.releases?.enabled === false ? null : phase("scheduleFeeds", () => fetchScheduleFeeds(config.releases || {}));

// ---------- 1. 収集 ----------
const enabled = Object.entries(config.sources).filter(([, on]) => on).map(([k]) => k);
log("sources:", enabled.join(", "));
const caches = await readJson(CACHE_FILE, {});
caches.producthunt = caches.producthunt || {};
const sourceSec = {};
const results = await phase(
  "sources",
  () =>
    Promise.allSettled(
      enabled.map(async (k) => {
        const t = Date.now();
        try {
          return await SOURCES[k](config, caches);
        } finally {
          sourceSec[k] = Math.round((Date.now() - t) / 100) / 10;
        }
      })
    )
);
await writeJson(CACHE_FILE, caches);

const raw = [];
const sourceStats = {};
results.forEach((r, i) => {
  const key = enabled[i];
  if (r.status === "fulfilled") {
    raw.push(...r.value);
    sourceStats[key] = { fetched: r.value.length, sec: sourceSec[key] };
    log(`${key}: ${r.value.length} items (${sourceSec[key]}s)`);
  } else {
    sourceStats[key] = { error: r.reason?.message || String(r.reason), sec: sourceSec[key] };
    log(`${key}: FAILED ${r.reason?.message || r.reason}`);
  }
});

// ---------- 2. フィルタ・分類・重複統合 ----------
const byId = new Map(existing.items.map((it) => [it.id, it]));
const blocked = [];
let added = 0;
let updated = 0;
let offFocus = 0;

const siteCfg = config.siteFilter || {};
const siteFilterOn = siteCfg.enabled !== false;
const isOffTopic = createSiteFilter(siteCfg);
const offTopic = [];

// 更新が止まったフィードが古い記事を返してくることがあるので、公開日が古すぎるものは取り込まない
const maxAgeMs = (config.maxArticleAgeDays ?? 90) * 86400000;
let tooOld = 0;

for (const r of raw) {
  if (!/^https?:\/\//i.test(r.url || "")) continue;
  const b = isBlocked(r);
  if (b.blocked) {
    blocked.push({ title: r.title, url: r.url, reason: b.reason });
    continue;
  }
  if (r.publishedAt && now.getTime() - new Date(r.publishedAt).getTime() > maxAgeMs) {
    tooOld++;
    continue;
  }
  r.headline = headlineOf(r);
  if (!inFocus(r)) {
    offFocus++;
    continue;
  }
  if (siteFilterOn) {
    // 記事・お知らせの個別ページはサイト（作品）のトップに寄せる。トップが 404 のサイト用に元の URL も残す
    r.linkUrl = r.url;
    r.url = toSiteRoot(r.url, siteCfg);
    const off = isOffTopic(r);
    if (off) {
      offTopic.push({ title: r.title, url: r.url, reason: off });
      continue;
    }
  }
  const id = idOf(r.key || (siteFilterOn ? canonicalKey(r.url) : r.url));
  const cat = categorizer.categorize(r);
  const prev = byId.get(id);
  const sourceRef = { name: r.source, url: r.sourceUrl };
  const region = regionOf(r.url, r.region);

  if (!prev) {
    byId.set(id, {
      id,
      url: r.url,
      host: hostOf(r.url),
      region,
      title: r.title,
      headline: r.headline,
      description: fallbackDescription(r),
      article: r.article || null,
      publishedAt: r.publishedAt || nowIso,
      addedAt: nowIso,
      source: r.source,
      sourceKind: r.sourceKind,
      sources: [sourceRef],
      tags: r.tags || [],
      phCategories: r.phCategories || [],
      categories: cat.categories,
      points: r.points ?? null,
      image: "",
      metaAttempts: 0,
      ...(r.linkUrl && r.linkUrl !== r.url ? { linkUrl: r.linkUrl } : {}),
      ...(r.resolved === false ? { unresolved: true } : {}),
    });
    added++;
  } else {
    if (prev.unresolved && r.resolved) {
      prev.url = r.url;
      prev.host = hostOf(r.url);
      delete prev.unresolved;
      prev.metaAttempts = 0;
      prev.image = "";
    }
    if (!prev.linkUrl && r.linkUrl && r.linkUrl !== r.url) prev.linkUrl = r.linkUrl;
    if (!prev.sources.some((s) => s.name === r.source)) prev.sources.push(sourceRef);
    if (!prev.region) prev.region = region;
    if (region === "jp" && !prev.regionDetected) prev.region = "jp";
    if (!prev.description && !prev.ogDescription) prev.description = fallbackDescription(r);
    if (!prev.headline && r.headline) prev.headline = r.headline;
    if (!prev.sourceKind) prev.sourceKind = r.sourceKind;
    if (r.article) prev.article = r.article; // 記事本文の解析結果は最新で上書き（事前登録の終了を反映するため）
    if (r.points != null) prev.points = r.points;
    for (const t of r.tags || []) if (!prev.tags.includes(t)) prev.tags.push(t);
    prev.phCategories = [...new Set([...(prev.phCategories || []), ...(r.phCategories || [])])];
    updated++;
  }
}

if (!config.producthunt?.includeUnresolved) {
  for (const [id, it] of byId) if (it.unresolved) byId.delete(id);
}

// ---------- 3. 保持期間を超えたもの・除外語に該当するものを削除 ----------
const cutoff = now.getTime() - (config.retentionDays || 60) * 86400000;
let pruned = 0;
for (const [id, it] of byId) {
  if (new Date(it.addedAt).getTime() < cutoff) {
    byId.delete(id);
    pruned++;
  }
}
for (const [id, it] of byId) {
  const b = isBlocked(it);
  if (b.blocked) {
    blocked.push({ title: it.title, url: it.url, reason: b.reason + " (existing)" });
    byId.delete(id);
  }
}
// 既存項目もゲーム特化の条件で見直す（方針変更・過去データの掃除に追従）
for (const [id, it] of byId) {
  if (!inFocus(it)) {
    byId.delete(id);
    offFocus++;
  }
}
// 古い記事から取り込まれた既存項目も掃除する
for (const [id, it] of byId) {
  if (it.publishedAt && now.getTime() - new Date(it.publishedAt).getTime() > maxAgeMs) {
    byId.delete(id);
    tooOld++;
  }
}

// 既存項目に残っている記事 URL・重複 URL を掃除する（新しい URL で取り直される）
if (siteFilterOn) {
  for (const [id, it] of byId) {
    // 以前の版が付けていた「index.html/」の末尾スラッシュや、壊れたストア URL を直す
    const repaired = cleanUrl(it.url).replace(/(\.(?:html?|php|aspx?))\/$/i, "$1");
    if (repaired !== it.url) {
      it.url = repaired;
      it.host = hostOf(repaired);
      delete it.dead;
      delete it.checkedAt;
    }
    if (it.rootFallback) continue; // トップが 404 だったので元の URL を採用済み
    const root = toSiteRoot(it.url, siteCfg);
    if (root !== it.url || idOf(canonicalKey(it.url)) !== id) {
      byId.delete(id);
      offTopic.push({ title: it.title, url: it.url, reason: "article url (existing)" });
    }
  }
}

const items = [...byId.values()];

// ---------- 4. OGP（画像・説明・言語）の取得 ----------
// 画像はサイトが共有用に公開している og:image をそのまま参照する（複製・再配布はしない）
// OGP の取得はリンク先が生きているかの確認も兼ねる。掲載済みのものも定期的に見直し、
// 404 やドメイン消滅になったものは公開 JSON から外す（ボット拒否の 403/429 やタイムアウトは生きている扱い）
const metaCfg = config.meta || {};
const recheckMs = (metaCfg.recheckHours ?? 24) * 3600000;
const needMeta = items
  .filter((it) => !it.ogFetchedAt && (it.metaAttempts || 0) < (metaCfg.maxAttempts ?? 3))
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  .slice(0, metaCfg.maxPerRun ?? 300);
const recheck = items
  .filter((it) => !needMeta.includes(it) && now.getTime() - new Date(it.checkedAt || it.ogFetchedAt || 0).getTime() > recheckMs)
  .sort((a, b) => new Date(a.checkedAt || a.ogFetchedAt || 0) - new Date(b.checkedAt || b.ogFetchedAt || 0))
  .slice(0, metaCfg.recheckPerRun ?? 40);
log(`meta targets: ${needMeta.length} new, ${recheck.length} recheck`);
let metaOk = 0;
let metaFail = 0;
await phase("meta", () => pool([...needMeta, ...recheck], metaCfg.concurrency ?? 6, async (it) => {
  if (!it.ogFetchedAt) it.metaAttempts = (it.metaAttempts || 0) + 1;
  it.checkedAt = nowIso;
  const timeoutMs = metaCfg.timeoutMs ?? 15000;
  let m = await fetchMeta(it.url, { timeoutMs });
  // 記事セグメントの手前で切ったトップが存在しないサイトは、記事に載っていた URL をそのまま使う
  if (m.gone && it.linkUrl && !it.rootFallback) {
    const alt = await fetchMeta(it.linkUrl, { timeoutMs });
    if (alt.ok) {
      m = alt;
      it.url = it.linkUrl;
      it.host = hostOf(it.url);
      it.rootFallback = true;
    }
  }
  if (!m.ok) {
    metaFail++;
    it.metaError = m.reason || `HTTP ${m.status}`;
    if (m.gone) {
      it.dead = { reason: it.metaError, since: it.dead?.since || nowIso, count: (it.dead?.count || 0) + 1 };
    } else {
      delete it.dead;
    }
    return;
  }
  metaOk++;
  delete it.metaError;
  delete it.dead;
  it.ogFetchedAt = nowIso;
  if (m.image) it.image = m.image;
  if (m.description) {
    it.description = truncate(m.description, metaCfg.descriptionLength ?? 120);
    it.ogDescription = true;
  }
  if (/^ja/i.test(m.lang) || m.jaRatio > 0.15) {
    it.region = "jp";
    it.regionDetected = true;
  } else if (m.textLen > 200 && m.lang && !/^ja/i.test(m.lang)) {
    it.region = "global";
    it.regionDetected = true;
  }
}));
log(`meta: ${metaOk} ok, ${metaFail} failed`);

// .jp ドメインは英語ページでも国内扱いに固定
for (const it of items) if (/\.jp$/.test(it.host)) it.region = "jp";

// ---------- ゲーム以外の最終判定 ----------
// OGP の説明文まで揃ったこの時点で判定すると、記事見出しだけのときより精度が上がる
if (siteFilterOn) {
  for (let i = items.length - 1; i >= 0; i--) {
    const off = isOffTopic(items[i]);
    if (off) {
      offTopic.push({ title: items[i].title, url: items[i].url, reason: off });
      byId.delete(items[i].id);
      items.splice(i, 1);
    }
  }
}

// カテゴリ・プラットフォームは蓄積した情報（見出し・OGP 説明・タグ）から毎回再計算する
for (const it of items) {
  it.categories = categorizer.categorize(it).categories;
  it.platforms = categorizer.detectPlatforms(it);
}

// ---------- 5. 保存 ----------
items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
// リンク切れは公開しない。404/410/ソフト 404 は即、ドメイン消滅・接続拒否は 2 回続いたら外す（復活したら戻る）
const isDead = (it) => it.dead && (/^HTTP 4(04|10)|soft 404/.test(it.dead.reason) || it.dead.count >= 2);
const shown = items.filter((it) => !isDead(it));
const deadItems = items.filter(isDead).map((it) => ({ title: it.title, url: it.url, reason: it.dead.reason, since: it.dead.since }));
if (deadItems.length) log(`dead links hidden: ${deadItems.length}`);
const categoryCounts = {};
for (const it of shown) for (const c of it.categories) categoryCounts[c] = (categoryCounts[c] || 0) + 1;
const regionCounts = { jp: 0, global: 0 };
for (const it of shown) regionCounts[it.region || "global"]++;

// 公開 JSON には表示に必要な項目だけを出す
const publicItems = shown.map((it) => ({
  id: it.id,
  url: it.url,
  host: it.host,
  region: it.region || "global",
  title: it.title,
  headline: it.headline && it.headline !== it.title ? truncate(it.headline, 90) : "",
  description: it.description || "",
  publishedAt: it.publishedAt,
  addedAt: it.addedAt,
  source: it.source,
  sources: it.sources,
  tags: it.tags.slice(0, 8),
  categories: it.categories,
  platforms: it.platforms || [],
  points: it.points ?? null,
  image: it.image || "",
}));
const platformCounts = {};
for (const it of shown) for (const p of it.platforms || []) platformCounts[p] = (platformCounts[p] || 0) + 1;

await writeJson(DATA_FILE, {
  updatedAt: nowIso,
  site: config.site || {},
  total: shown.length,
  regions: regionCounts,
  categories: categorizer.all.map((c) => ({ ...c, count: categoryCounts[c.id] || 0 })),
  platforms: categorizer.platforms.map((p) => ({ ...p, count: platformCounts[p.id] || 0 })),
  sources: [...new Set(shown.map((it) => it.source))],
  items: publicItems,
});

// 内部状態（メタ取得の試行回数など）は別ファイルに保持
await writeJson(join(ROOT, "data", "state.json"), { items });

// ---------- 5.5 note の記事一覧（自分の記事）: 冒頭で始めた取得を受け取る ----------
{
  const r = await notePromise;
  if (!r.ok) log("note failed:", r.error?.message || r.error);
  else if (r.value) await writeJson(join(ROOT, "docs", "data", "notes.json"), r.value);
}

// ---------- 5.5 ゲームの人気ランキング（Steam / App Store） ----------
{
  const r = await rankingsPromise;
  if (!r.ok) log("rankings failed:", r.error?.message || r.error);
  else if (r.value) {
    await writeJson(join(ROOT, "docs", "data", "rankings.json"), r.value);
    await writeJson(join(ROOT, "data", "rankings-state.json"), rankCache);
    log(`rankings: ${r.value.boards.map((b) => `${b.label}=${b.items.length}`).join(" ")}`);
  }
}

// Google トレンドは日本全体の急上昇でゲーム以外が多く混ざるため既定では取得しない
if (config.trends?.enabled === true) {
  try {
    const trendsCache = await readJson(join(ROOT, "data", "trends-state.json"), {});
    const trends = await fetchTrends({ limit: config.trends?.limit ?? 20, cache: trendsCache });
    await writeJson(join(ROOT, "docs", "data", "trends.json"), trends);
    await writeJson(join(ROOT, "data", "trends-state.json"), trendsCache);
  } catch (e) {
    log("trends failed:", e.message);
  }
}

// ---------- 6. リリーススケジュール / 事前登録 ----------
let scheduleStats = null;
if (config.releases?.enabled !== false) {
  try {
    // スケジュールの状態（タイトルごとの発売日・事前登録・変更履歴）は
    // GitHub Actions でも引き継げるよう、コミット対象のファイルに保存する
    const stateFile = join(ROOT, "data", "schedule-state.json");
    const scheduleCache = await readJson(stateFile, {});
    // 事前登録の一覧ページからタイトル名を拾い、App Store で予約状況を裏取りする材料にする
    const preregRes = await preregListsPromise;
    if (!preregRes.ok) log("prereg lists failed:", preregRes.error?.message || preregRes.error);
    const extraTitles = preregRes.ok ? preregRes.value : [];
    const schedule = await phase("schedule", () =>
      buildSchedule(config, shown, {
        platformDetector: (it) => categorizer.detectPlatforms(it),
        cache: scheduleCache,
        extraTitles,
        feeds: scheduleFeedsPromise,
      })
    );
    schedule.platforms = categorizer.platforms;
    await writeJson(join(ROOT, "docs", "data", "schedule.json"), schedule);

    // トップページは 14 行 + 事前登録 8 件しか使わないので、軽い抜粋を別に書き出す
    // （全件の schedule.json は 450KB 超あり、トップの表示を待たせる原因になる）
    const topReleases = schedule.releases
      .filter((r) => r.date)
      .slice()
      .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.sortKey.localeCompare(b.sortKey))
      .slice(0, 14)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    // 事前登録ページも全件のスケジュールは要らない
    await writeJson(join(ROOT, "docs", "data", "prereg.json"), {
      updatedAt: schedule.updatedAt,
      platforms: schedule.platforms,
      prereg: schedule.prereg,
    });
    await writeJson(join(ROOT, "docs", "data", "schedule-top.json"), {
      updatedAt: schedule.updatedAt,
      platforms: schedule.platforms,
      releases: topReleases,
      prereg: schedule.prereg.slice(0, 8),
      changes: schedule.changes.slice(0, 6),
    });
    await writeJson(stateFile, scheduleCache);
    scheduleStats = { ...schedule.stats, releases: schedule.releases.length, changes: schedule.changes.length };
    log(
      `schedule: releases=${schedule.releases.length} prereg=${schedule.prereg.length} changes=${schedule.changes.length} (${JSON.stringify(schedule.stats)})`
    );
  } catch (e) {
    scheduleStats = { error: e.message };
    log("schedule failed:", e.message);
  }
}

const summary = {
  ranAt: nowIso,
  durationSec: Math.round((Date.now() - started) / 1000),
  timings,
  fetched: raw.length,
  added,
  updated,
  pruned,
  offFocus,
  tooOld,
  offTopic: offTopic.length,
  offTopicItems: offTopic.slice(0, 60),
  blocked: blocked.length,
  blockedItems: blocked.slice(0, 50),
  meta: { ok: metaOk, failed: metaFail, noImage: items.filter((it) => !it.image).length },
  deadLinks: deadItems.length,
  deadLinkItems: deadItems.slice(0, 60),
  schedule: scheduleStats,
  sources: sourceStats,
  total: items.length,
};
await writeJson(RUN_FILE, summary);
log(
  `done in ${summary.durationSec}s: total=${items.length} added=${added} updated=${updated} pruned=${pruned} offFocus=${offFocus} tooOld=${tooOld} offTopic=${offTopic.length} blocked=${blocked.length} noImage=${summary.meta.noImage}`
);
if (blocked.length) log("blocked:", blocked.map((b) => `${b.title} [${b.reason}]`).join(" | "));
