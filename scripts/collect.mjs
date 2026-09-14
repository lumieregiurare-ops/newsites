// 新着サイト収集スクリプト: フィード取得 → 除外フィルタ → カテゴリ分類 → OGP 取得 → docs/data/sites.json
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJson, writeJson, idOf, hostOf, log, pool, truncate } from "./lib/util.mjs";
import { SOURCES } from "./lib/sources.mjs";
import { createBlockChecker } from "./lib/filter.mjs";
import { createCategorizer } from "./lib/categorize.mjs";
import { fetchMeta } from "./lib/meta.mjs";
import { buildSchedule } from "./lib/schedule.mjs";
import { toSiteRoot, createSiteFilter, canonicalKey } from "./lib/siteurl.mjs";
import { fetchPreregTitles } from "./lib/preregLists.mjs";

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

// ---------- 1. 収集 ----------
const enabled = Object.entries(config.sources).filter(([, on]) => on).map(([k]) => k);
log("sources:", enabled.join(", "));
const caches = await readJson(CACHE_FILE, {});
caches.producthunt = caches.producthunt || {};
const results = await Promise.allSettled(enabled.map((k) => SOURCES[k](config, caches)));
await writeJson(CACHE_FILE, caches);

const raw = [];
const sourceStats = {};
results.forEach((r, i) => {
  const key = enabled[i];
  if (r.status === "fulfilled") {
    raw.push(...r.value);
    sourceStats[key] = { fetched: r.value.length };
    log(`${key}: ${r.value.length} items`);
  } else {
    sourceStats[key] = { error: r.reason?.message || String(r.reason) };
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
    // 記事・お知らせの個別ページはサイト（作品）のトップに寄せる
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
const metaCfg = config.meta || {};
const needMeta = items
  .filter((it) => !it.ogFetchedAt && (it.metaAttempts || 0) < (metaCfg.maxAttempts ?? 3))
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  .slice(0, metaCfg.maxPerRun ?? 300);
log(`meta targets: ${needMeta.length}`);
let metaOk = 0;
let metaFail = 0;
await pool(needMeta, metaCfg.concurrency ?? 6, async (it) => {
  it.metaAttempts = (it.metaAttempts || 0) + 1;
  const m = await fetchMeta(it.url, { timeoutMs: metaCfg.timeoutMs ?? 15000 });
  if (!m.ok) {
    metaFail++;
    it.metaError = m.reason || `HTTP ${m.status}`;
    return;
  }
  metaOk++;
  delete it.metaError;
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
});
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
const categoryCounts = {};
for (const it of items) for (const c of it.categories) categoryCounts[c] = (categoryCounts[c] || 0) + 1;
const regionCounts = { jp: 0, global: 0 };
for (const it of items) regionCounts[it.region || "global"]++;

// 公開 JSON には表示に必要な項目だけを出す
const publicItems = items.map((it) => ({
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
for (const it of items) for (const p of it.platforms || []) platformCounts[p] = (platformCounts[p] || 0) + 1;

await writeJson(DATA_FILE, {
  updatedAt: nowIso,
  site: config.site || {},
  total: items.length,
  regions: regionCounts,
  categories: categorizer.all.map((c) => ({ ...c, count: categoryCounts[c.id] || 0 })),
  platforms: categorizer.platforms.map((p) => ({ ...p, count: platformCounts[p.id] || 0 })),
  sources: [...new Set(items.map((it) => it.source))],
  items: publicItems,
});

// 内部状態（メタ取得の試行回数など）は別ファイルに保持
await writeJson(join(ROOT, "data", "state.json"), { items });

// ---------- 6. リリーススケジュール / 事前登録 ----------
let scheduleStats = null;
if (config.releases?.enabled !== false) {
  try {
    // スケジュールの状態（タイトルごとの発売日・事前登録・変更履歴）は
    // GitHub Actions でも引き継げるよう、コミット対象のファイルに保存する
    const stateFile = join(ROOT, "data", "schedule-state.json");
    const scheduleCache = await readJson(stateFile, {});
    // 事前登録の一覧ページからタイトル名を拾い、App Store で予約状況を裏取りする材料にする
    const extraTitles = config.releases?.preregLists?.enabled === false ? [] : await fetchPreregTitles(config.releases?.preregLists || {});
    const schedule = await buildSchedule(config, items, {
      platformDetector: (it) => categorizer.detectPlatforms(it),
      cache: scheduleCache,
      extraTitles,
    });
    schedule.platforms = categorizer.platforms;
    await writeJson(join(ROOT, "docs", "data", "schedule.json"), schedule);
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
  schedule: scheduleStats,
  sources: sourceStats,
  total: items.length,
};
await writeJson(RUN_FILE, summary);
log(
  `done in ${summary.durationSec}s: total=${items.length} added=${added} updated=${updated} pruned=${pruned} offFocus=${offFocus} tooOld=${tooOld} offTopic=${offTopic.length} blocked=${blocked.length} noImage=${summary.meta.noImage}`
);
if (blocked.length) log("blocked:", blocked.map((b) => `${b.title} [${b.reason}]`).join(" | "));
