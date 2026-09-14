import { UA, fetchText, fetchJson, cleanUrl, hostOf, pool, log, truncate } from "./util.mjs";
import { parseFeed, stripTags, firstImage, decodeEntities } from "./xml.mjs";

// 各収集元は共通形式の配列を返す:
// { source, sourceKind, sourceUrl, url, title, description, publishedAt, tags, phCategories, image, points }

// ---------- Product Hunt ----------
export async function fetchProductHunt(cfg) {
  const byPost = new Map();

  async function load(category) {
    const url = "https://www.producthunt.com/feed" + (category ? `?category=${category}` : "");
    const xml = await fetchText(url);
    for (const e of parseFeed(xml)) {
      const postId = (e.id.match(/Post\/(\d+)/) || [])[1];
      if (!postId) continue;
      const html = e.content; // 二重エスケープされた HTML
      const tagline = stripTags(html.split(/<\/p>/i)[0] || "");
      const redirect = (decodeEntities(html).match(/href="(https:\/\/www\.producthunt\.com\/r\/p\/\d+[^"]*)"/) || [])[1];
      let rec = byPost.get(postId);
      if (!rec) {
        rec = {
          source: "Product Hunt",
          sourceKind: "launch",
          sourceUrl: e.link,
          redirect,
          title: e.title,
          description: truncate(tagline, 200),
          publishedAt: e.date ? new Date(e.date).toISOString() : null,
          tags: [],
          phCategories: [],
          image: "",
        };
        byPost.set(postId, rec);
      }
      if (category) rec.phCategories.push(category);
    }
  }

  await load("");
  for (const c of cfg.categories || []) {
    try {
      await load(c);
    } catch (e) {
      log("Product Hunt category failed:", c, e.message);
    }
  }

  const posts = [...byPost.entries()].filter(([, r]) => r.redirect);
  log(`Product Hunt: ${posts.length} posts`);

  // /r/p/ID のリダイレクトは Cloudflare のボット判定を受けやすいので、
  // 未解決のものだけを間隔を空けて逐次解決し、結果をキャッシュする。
  // 連続で拒否されたらそのランでは諦め、次回に持ち越す。
  const cache = cfg._cache || {};
  const delayMs = cfg.resolveDelayMs ?? 2000;
  const maxPerRun = cfg.maxResolvePerRun ?? 60;
  const pending = posts
    .filter(([id]) => !cache[id]?.url && (cache[id]?.attempts || 0) < 5)
    .sort((a, b) => new Date(b[1].publishedAt || 0) - new Date(a[1].publishedAt || 0))
    .slice(0, maxPerRun);
  let consecutiveBlocked = 0;
  let resolvedNow = 0;
  for (const [id, r] of pending) {
    const entry = (cache[id] = cache[id] || { attempts: 0 });
    entry.attempts++;
    entry.lastTriedAt = new Date().toISOString();
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
      const res = await fetch(r.redirect, { redirect: "manual", headers: { "user-agent": UA }, signal: ac.signal }).finally(() => clearTimeout(timer));
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc && !/producthunt\.com/.test(hostOf(loc))) {
        entry.url = cleanUrl(new URL(loc, r.redirect).toString());
        consecutiveBlocked = 0;
        resolvedNow++;
      } else {
        entry.lastStatus = res.status;
        if (res.status === 403 || res.status === 429) {
          consecutiveBlocked++;
          entry.attempts--; // ボット判定による拒否は投稿側の問題ではないので試行回数に数えない
        }
      }
    } catch (e) {
      entry.lastStatus = e.message;
    }
    if (consecutiveBlocked >= 3) {
      log(`Product Hunt: redirect blocked (status ${cache[id].lastStatus}), giving up for this run`);
      break;
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  const resolvedTotal = posts.filter(([id]) => cache[id]?.url).length;
  log(`Product Hunt: resolved ${resolvedNow} now, ${resolvedTotal}/${posts.length} total`);

  return posts
    .filter(([id]) => cfg.includeUnresolved || cache[id]?.url)
    .map(([id, { redirect, ...rest }]) => {
      const real = cache[id]?.url;
      return {
        ...rest,
        key: rest.sourceUrl, // 重複判定は PH の製品ページ URL で安定させる
        url: real || rest.sourceUrl,
        resolved: !!real,
        noScreenshot: !real, // PH ページ自体は撮影できない
      };
    });
}

// ---------- Hacker News (Show HN) ----------
export async function fetchHackerNews(cfg) {
  const data = await fetchJson(
    `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=${cfg.hitsPerPage || 100}`
  );
  const exclude = new Set((cfg.excludeHosts || []).map((h) => h.toLowerCase()));
  const items = [];
  for (const h of data.hits || []) {
    if (!h.url) continue;
    const host = hostOf(h.url).toLowerCase();
    if ([...exclude].some((x) => host === x || host.endsWith("." + x))) continue;
    if ((h.points || 0) < (cfg.minPoints || 0)) continue;
    items.push({
      source: "Hacker News",
      sourceKind: "launch",
      sourceUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
      url: cleanUrl(h.url),
      title: h.title.replace(/^show hn:\s*/i, "").trim(),
      description: truncate(stripTags(h.story_text || ""), 200),
      publishedAt: h.created_at,
      tags: ["Show HN"],
      phCategories: [],
      image: "",
      points: h.points || 0,
      comments: h.num_comments || 0,
    });
  }
  return items;
}

// ---------- One Page Love ----------
export async function fetchOnePageLove() {
  const xml = await fetchText("https://onepagelove.com/feed");
  const entries = parseFeed(xml).filter((e) => /Website Inspiration/i.test(e.title) || e.categories.includes("Inspiration"));
  const items = await pool(entries, 4, async (e) => {
    const page = await fetchText(e.link);
    const m = page.match(/<a[^>]+href="([^"]+)"[^>]*title="Visit [^"]*Website"/i) || page.match(/title="Visit [^"]*Website"[^>]*href="([^"]+)"/i);
    if (!m) return null;
    return {
      source: "One Page Love",
      sourceKind: "gallery",
      sourceUrl: e.link,
      url: cleanUrl(decodeEntities(m[1])),
      title: e.title.replace(/^Website Inspiration:\s*/i, "").trim(),
      description: truncate(stripTags(e.description || e.content).replace(/Full Review$/i, ""), 200),
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      tags: e.categories.filter((c) => c !== "Inspiration"),
      phCategories: [],
      image: firstImage(e.content),
    };
  });
  return items.filter((x) => x && !x.error);
}

// ---------- minimal.gallery ----------
export async function fetchMinimalGallery() {
  const xml = await fetchText("https://minimal.gallery/feed/");
  const entries = parseFeed(xml);
  const items = await pool(entries, 4, async (e) => {
    const page = await fetchText(e.link);
    const m = page.match(/class="single-post-breadcrumbs-button"[^>]*href="([^"]+)"/i) || page.match(/href="([^"]+)"[^>]*title="Visit website"/i);
    if (!m) return null;
    return {
      source: "minimal.gallery",
      sourceKind: "gallery",
      sourceUrl: e.link,
      url: cleanUrl(decodeEntities(m[1])),
      title: e.title.trim(),
      description: "",
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      tags: e.categories.filter((c) => c !== "Uncategorized"),
      phCategories: [],
      image: firstImage(e.content),
    };
  });
  return items.filter((x) => x && !x.error);
}

// ---------- Launching Next ----------
export async function fetchLaunchingNext() {
  const xml = await fetchText("https://www.launchingnext.com/rss/");
  const entries = parseFeed(xml);
  const items = await pool(entries, 3, async (e) => {
    const page = await fetchText(e.link);
    const m = page.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*Visit Website/i);
    if (!m) return null;
    // media:content の URL がドメイン二重になっているケースを補正
    let image = (xml.match(new RegExp(`<link>${e.link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</link>[\\s\\S]*?<media:content url="([^"]+)"`)) || [])[1] || "";
    image = image.replace(/^https:\/\/www\.launchingnext\.com(?=https?:\/\/)/, "");
    return {
      source: "Launching Next",
      sourceKind: "launch",
      sourceUrl: e.link,
      url: cleanUrl(decodeEntities(m[1])),
      title: e.title.trim(),
      description: truncate(stripTags(e.description || ""), 200),
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      tags: [],
      phCategories: [],
      image,
    };
  });
  return items.filter((x) => x && !x.error);
}

// ---------- PitchWall (旧 BetaPage) ----------
export async function fetchPitchWall() {
  const xml = await fetchText("https://betapage.co/rss");
  const entries = parseFeed(xml);
  const items = await pool(entries, 3, async (e) => {
    const page = await fetchText(e.link);
    const m = page.match(/<a[^>]+href="(https?:\/\/(?!(?:auth\.|cdn\.|www\.)?pitchwall\.co)[^"]+)"[^>]*>(?:(?!<\/a>)[\s\S]){0,800}?Visit Website/i);
    if (!m) return null;
    return {
      source: "PitchWall",
      sourceKind: "launch",
      sourceUrl: e.link.replace(/^https:\/\/auth\./, "https://"),
      url: cleanUrl(decodeEntities(m[1])),
      title: e.title.trim(),
      description: truncate(stripTags(e.content || ""), 200),
      publishedAt: e.date ? new Date(e.date.replace(" ", "T") + "Z").toISOString() : null,
      tags: [],
      phCategories: [],
      image: "",
    };
  });
  return items.filter((x) => x && !x.error);
}

// ---------- 国内 Web デザインギャラリー（WordPress 系 RSS） ----------
// 掲載ページ内の外部リンクから実サイト URL を取る。抽出ルールはサイトごとに指定。
// extraFeeds: エンタメ系などカテゴリ別フィード。取得した項目には tags を強制付与して分類を安定させる
const JP_GALLERIES = {
  muuuuu: {
    name: "MUUUUU.ORG",
    feed: "https://muuuuu.org/feed",
    extraFeeds: [
      { url: "https://muuuuu.org/category/industry/entertainment/feed", tags: ["エンタメ"] },
      { url: "https://muuuuu.org/category/industry/music/feed", tags: ["音楽"] },
      { url: "https://muuuuu.org/category/industry/art/feed", tags: ["アート"] },
    ],
    pick: (page) => (page.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="c-linelink--hidden"/i) || page.match(/class="c-linelink--hidden"[^>]*href="(https?:\/\/[^"]+)"/i) || [])[1],
    ignoreTags: /^(日本語サイト|レスポンシブ対応|多言語対応|.*系$)/,
  },
  sankou: {
    name: "SANKOU!",
    feed: "https://sankoudesign.com/feed/",
    extraFeeds: [
      { url: "https://sankoudesign.com/category/campaign-event-special/feed/", tags: ["特設サイト"] },
      { url: "https://sankoudesign.com/category/music/feed/", tags: ["音楽", "エンタメ"] },
      { url: "https://sankoudesign.com/category/comic-anime-game/feed/", tags: ["アニメ", "ゲーム"] },
      { url: "https://sankoudesign.com/category/game-diagnosis-maker/feed/", tags: ["ゲーム"] },
      { url: "https://sankoudesign.com/category/event-festival/feed/", tags: ["イベント"] },
      { url: "https://sankoudesign.com/category/culture-art/feed/", tags: ["アート"] },
    ],
    pick: (page, e) => firstExternal(page, "sankoudesign.com"),
  },
  io3000: {
    name: "I/O 3000",
    feed: "https://io3000.com/feed/",
    pick: (page, e) => (e.content.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i) || [])[1],
    noPageFetch: true,
    ignoreTags: /^(カテゴリ|カラー|responsive|white|black|gray|grey|blue|red|green|yellow|orange|pink|purple|brown|beige|colorful|monotone)$/i,
  },
  webdesignclip: {
    name: "Web Design Clip",
    feed: "https://webdesignclip.com/feed",
    extraFeeds: [
      { url: "https://webdesignclip.com/category/tv/feed", tags: ["エンタメ"] },
      { url: "https://webdesignclip.com/category/game/feed", tags: ["ゲーム"] },
      { url: "https://webdesignclip.com/category/movie/feed", tags: ["映画"] },
      { url: "https://webdesignclip.com/category/music/feed", tags: ["音楽"] },
      { url: "https://webdesignclip.com/category/art/feed", tags: ["アート"] },
      { url: "https://webdesignclip.com/tag/special-site/feed", tags: ["特設サイト"] },
    ],
    pick: (page) => firstExternal(page, "webdesignclip.com"),
    ignoreTags: /^(Main_Color|Sub_Color|Layouot)/,
    dropImage: true,
  },
  oneguu: {
    name: "1guu",
    feed: "https://1guu.jp/feed",
    extraFeeds: [
      { url: "https://1guu.jp/category/industry/entertainment/feed/", tags: ["エンタメ"] },
      { url: "https://1guu.jp/category/industry/tv/feed/", tags: ["アニメ", "映画"] },
      { url: "https://1guu.jp/category/industry/musics/feed/", tags: ["音楽"] },
      { url: "https://1guu.jp/category/industry/leisure/feed/", tags: ["レジャー"] },
    ],
    pick: (page) => firstExternal(page, "1guu.jp"),
  },
  responsivejp: {
    name: "Responsive Web Design JP",
    feed: "https://responsive-jp.com/feed",
    extraFeeds: [{ url: "https://responsive-jp.com/category/category/art/feed", tags: ["アート"] }],
    pick: (page) => firstExternal(page, "responsive-jp.com"),
  },
};

const NOISE_HOSTS = /twitter|facebook|instagram|linkedin|pinterest|x\.com|youtube|bsky|apple\.com|google|wordpress|w3\.org|gravatar|hatena|line\.me|note\.com|amazon|wp-content|feedly|getpocket|climarks/i;
function firstExternal(page, ownHost) {
  for (const m of page.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*target="_blank"/gi)) {
    const href = m[1];
    if (href.includes(ownHost) || NOISE_HOSTS.test(href)) continue;
    return href;
  }
  return undefined;
}

export async function fetchJpGallery(key, { maxAgeDays = 45 } = {}) {
  const g = JP_GALLERIES[key];
  const byLink = new Map();
  const cutoff = Date.now() - maxAgeDays * 86400000;

  const feeds = [{ url: g.feed, tags: [] }, ...(g.extraFeeds || [])];
  for (const f of feeds) {
    let entries;
    try {
      entries = parseFeed(await fetchText(f.url));
    } catch (e) {
      log(`${g.name}: feed failed ${f.url} (${e.message})`);
      continue;
    }
    for (const e of entries) {
      if (!e.link) continue;
      if (e.date && new Date(e.date).getTime() < cutoff) continue;
      const prev = byLink.get(e.link);
      if (prev) {
        for (const t of f.tags) if (!prev.forcedTags.includes(t)) prev.forcedTags.push(t);
      } else {
        byLink.set(e.link, { ...e, forcedTags: [...f.tags] });
      }
    }
  }

  const items = await pool([...byLink.values()], 3, async (e) => {
    const page = g.noPageFetch ? "" : await fetchText(e.link);
    const href = g.pick(page, e);
    if (!href) return null;
    const image = g.dropImage ? "" : firstImage(e.content);
    return {
      source: g.name,
      sourceKind: "gallery",
      region: "jp",
      sourceUrl: e.link,
      url: cleanUrl(decodeEntities(href)),
      title: e.title.trim(),
      description: truncate(stripTags(e.description || "").replace(/^\s*$/, ""), 200),
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      tags: [...e.forcedTags, ...e.categories.filter((c) => !(g.ignoreTags && g.ignoreTags.test(c)))].slice(0, 14),
      phCategories: [],
      image: /^https?:\/\//.test(image) && !/-\d{2,3}x\d{2,3}\./.test(image) ? image : "",
    };
  });
  return items.filter((x) => x && !x.error);
}

// ---------- ゲームニュース → 記事内の「公式サイト」リンク ----------
// 発表・ティザー・周年・事前登録などの記事から、リンクされている公式サイト / 特設サイトを拾う
// feeds: 総合フィードは直近 100 件程度しか持たないので、スマホ・PC などカテゴリ別フィードも併せて読む
const GAME_NEWS = {
  fourgamer: {
    name: "4Gamer",
    feeds: [
      "https://www.4gamer.net/rss/index.xml",
      "https://www.4gamer.net/rss/pc/pc_news.xml",
      // 事前登録情報の一覧ページ（RSS なし・EUC-JP）。記事 50 件分が並ぶので事前登録の取りこぼしを大きく減らせる
      { url: "https://www.4gamer.net/smartphone/preregistration/", parse: "4gamer-list", encoding: "euc-jp" },
    ],
    host: "4gamer.net",
  },
  gamespark: { name: "Game*Spark", feeds: ["https://www.gamespark.jp/rss20/index.rdf"], host: "gamespark.jp" },
  // mobile.rdf は 2022 年で更新が止まった廃止フィードのため使わない
  insidegames: { name: "Inside", feeds: ["https://www.inside-games.jp/rss20/index.rdf"], host: "inside-games.jp" },
  gamebusiness: { name: "GameBusiness.jp", feeds: ["https://www.gamebusiness.jp/rss20/index.rdf"], host: "gamebusiness.jp" },
  denfami: {
    name: "電ファミニコゲーマー",
    feeds: ["https://news.denfaminicogamer.jp/feed", "https://news.denfaminicogamer.jp/tag/%E3%82%B9%E3%83%9E%E3%83%BC%E3%83%88%E3%83%95%E3%82%A9%E3%83%B3/feed"],
    host: "denfaminicogamer.jp",
  },
  appbank: { name: "AppBank", feeds: ["https://www.appbank.net/category/game/feed"], host: "appbank.net" },
  applivgames: { name: "Appliv Games", feeds: ["https://games.app-liv.jp/feed"], host: "app-liv.jp" },
};

// RSS の無い一覧ページを、フィードと同じ {title, link, date} の配列に変換する
async function parseHtmlList(feed) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetch(feed.url, { headers: { "user-agent": UA, accept: "text/html", "accept-language": "ja" }, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = new TextDecoder(feed.encoding || "utf-8").decode(await r.arrayBuffer());
    if (feed.parse === "4gamer-list") {
      // <h2><a id="ARTICLE_LINK_20260914010" href="/games/991/G099198/20260914010/">見出し</a></h2>
      return [...html.matchAll(/<h2><a id="ARTICLE_LINK_(\d{8})\d*" href="(\/games\/\d+\/G\d+\/\d+\/)">([^<]+)<\/a><\/h2>/g)].map((m) => ({
        id: m[2],
        link: "https://www.4gamer.net" + m[2],
        title: decodeEntities(m[3]).trim(),
        date: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T09:00:00+09:00`,
        content: "",
        categories: [],
      }));
    }
    return [];
  } finally {
    clearTimeout(t);
  }
}

// 「◯◯公式サイト」と書かれていても、作品ではなくイベントや業界団体のポータルを指すリンクは採用しない
const EVENT_PORTAL_RE = /tgs\.cesa\.or\.jp|cedec\.cesa\.or\.jp|(^|\.)cesa\.or\.jp|jesu\.or\.jp|gamescom|bitsummit/i;
const GAME_ANNOUNCE_RE = /発表|ティザー|公式サイト|特設サイト|キャンペーン|周年|事前登録|配信開始|発売決定|発売日|サービス開始|新作|リリース|オープン|公開|始動|決定|開催|コラボ|正式|β|ベータ|体験版|予約/;
const OFFICIAL_TEXT_RE = /公式サイト|公式ページ|公式ホームページ|公式HP|公式Web|オフィシャルサイト|ティザーサイト|特設サイト|キャンペーンサイト|スペシャルサイト|周年サイト|ポータルサイト|プロモーションサイト/i;
const GAME_STORE_RE = /store\.steampowered|steampowered|apps\.apple|itunes\.apple|play\.google|nintendo\.(co|com)|playstation\.com|xbox\.com|epicgames|gog\.com|twitter\.com|x\.com|youtube|youtu\.be|facebook|instagram|tiktok|discord|twitch|line\.me|note\.com|amazon|amzn\.to|rakuten|wikipedia|google|iid\.(co\.)?jp|ads2\.iid|dmm\.co|famitsu|4gamer|gamespark|inside-games|gamebusiness|denfaminicogamer|automaton|aetas\.co\.jp|entame-print|1kuji\.com|bandainamco-am|abema\.tv|bsky\.app|\.(jpg|png|gif)$/i;

function gameNameFromTitle(title) {
  const m = title.match(/『([^』]{2,40})』/) || title.match(/「([^」『』]{2,40})」/);
  if (m) return m[1].replace(/[『』「」]/g, "").trim();
  return truncate(title.split(/[ー―！!。]/)[0], 60);
}

// 記事本文から事前登録の状況・特典・登録者数・配信時期・ストア ID を読み取る。
// 見出しに「事前登録開始」と書かれない記事を取りこぼさないための処理。
const PREREG_ACTIVE_RE =
  /事前登録(?:キャンペーン)?(?:の)?(?:受付)?(?:が|を|は|も)?(?:本日|現在|すでに)?(?:より|から)?(?:開始|受付中|実施中|スタート|受付開始|受け付け中)|事前登録受付|事前登録はこちら|事前登録者数|事前登録特典|事前登録報酬|予約注文(?:が|を|は)?(?:開始|受付中|受付開始)|事前予約(?:が|を|は)?(?:開始|受付中)/;
const PREREG_END_RE = /事前登録(?:の受付)?(?:は|が|を)?(?:終了|締め切|締切|終了しま)/;
// サイト共通のナビゲーション（「事前登録情報」などのリンク集）を落とす
const CHROME_RE = /<(nav|header|footer|aside|script|style|form|select)\b[\s\S]*?<\/\1>/gi;

export function analyzeArticleBody(html, title = "") {
  const cleaned = html
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(CHROME_RE, " ")
    .replace(/<ul\b[^>]*class="[^"]*(nav|menu|breadcrumb|global)[^"]*"[\s\S]*?<\/ul>/gi, " ");
  // 記事の後ろには関連記事・別タイトルの情報が続くことが多いので、判定は本文の前半に限る
  const lead = stripTags(cleaned).slice(0, 6000);
  const scope = `${title}\n${lead}`;

  const ended = PREREG_END_RE.test(scope);
  const prereg = !ended && (PREREG_ACTIVE_RE.test(scope) || /事前登録|予約注文/.test(title));

  const countM = scope.match(/事前登録者?数?[^。\n]{0,12}?([\d,.]+\s*[万億]?)\s*人/);
  const rewardM = scope.match(/事前登録(?:特典|報酬)(?:として|には|は|に|：|:)?\s*[「『]?([^。」』\n]{4,60})/);

  const iosM =
    cleaned.match(/apps\.apple\.com\/[a-z]{2}\/app\/[^"'\s]*?\/id(\d+)/) ||
    cleaned.match(/apps\.apple\.com\/[a-z]{2}\/app\/id(\d+)/);
  const androidM = cleaned.match(/play\.google\.com\/store\/apps\/details\?id=([\w.]+)/);

  return {
    prereg,
    preregEnded: ended,
    count: countM ? countM[0].replace(/\s+/g, "") : "",
    reward: rewardM ? rewardM[1].trim().slice(0, 50) : "",
    ios: iosM?.[1] || "",
    android: androidM?.[1] || "",
  };
}

export async function fetchGameNews(key) {
  const g = GAME_NEWS[key];
  const byLink = new Map();
  for (const feed of g.feeds) {
    const url = typeof feed === "string" ? feed : feed.url;
    try {
      const entries = typeof feed === "string" ? parseFeed(await fetchText(url)) : await parseHtmlList(feed);
      for (const e of entries) {
        if (e.link && GAME_ANNOUNCE_RE.test(e.title) && !byLink.has(e.link)) byLink.set(e.link, e);
      }
    } catch (err) {
      log(`${g.name}: feed failed ${url} (${err.message})`);
    }
  }
  const entries = [...byLink.values()];
  const seen = new Set();
  const items = await pool(entries, 3, async (e) => {
    const html = await fetchText(e.link);
    let official = null;
    let storeLink = null; // スマホゲームは公式サイトが無く App Store / Google Play だけのことがあるので、その場合はストアページを採用
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,160}?)<\/a>/gi)) {
      const href = (m[1].match(/href="(https?:\/\/[^"]+)"/) || [])[1];
      if (!href || href.includes(g.host)) continue;
      if (/apps\.apple\.com\/|play\.google\.com\/store\/apps/.test(href)) {
        if (!storeLink) storeLink = href.replace(/[?&]at=[^&]*/, "").replace(/\?$/, "");
        continue;
      }
      if (GAME_STORE_RE.test(href)) continue;
      // 記事がそのイベント自体を扱っているのでなければ、イベント公式サイトは作品の公式サイトではない
      if (EVENT_PORTAL_RE.test(href) && !EVENT_PORTAL_RE.test(e.title) && !/東京ゲームショウ|TGS|CEDEC/i.test(e.title)) continue;
      const text = stripTags(m[2]);
      const isOfficial = OFFICIAL_TEXT_RE.test(text) || /class="[^"]*\bofficial\b/.test(m[1]) || /alt="公式サイト/.test(m[2]);
      if (isOfficial) {
        official = href;
        break;
      }
    }
    if (!official && !storeLink) return null;
    const tags = ["ゲーム"];
    if (!official) tags.push("スマホ", /apps\.apple/.test(storeLink) ? "iOS" : "Android");
    if (/ティザー/.test(e.title)) tags.push("ティザーサイト");
    if (/特設|キャンペーン|スペシャルサイト/.test(e.title)) tags.push("特設サイト");
    if (/周年/.test(e.title)) tags.push("周年");

    const body = analyzeArticleBody(html, e.title);
    if (body.prereg) tags.push("事前登録");
    if (body.ios) tags.push("iOS");
    if (body.android) tags.push("Android");
    if (body.ios || body.android) tags.push("スマホ");

    return {
      source: g.name,
      sourceKind: "news",
      region: "jp",
      sourceUrl: e.link,
      url: cleanUrl(decodeEntities(official || storeLink)),
      title: gameNameFromTitle(e.title),
      description: truncate(e.title, 200),
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      tags: [...new Set(tags)],
      phCategories: [],
      image: "",
      article: body,
    };
  });
  return items.filter((x) => x && !x.error && !seen.has(x.url) && seen.add(x.url));
}

// ---------- App Store 新着ゲーム（日本ストア） ----------
// RSS で新着アプリを取り、lookup API でジャンル・公式サイト（sellerUrl）・アートワークを補う
const APPSTORE_JUNK_URL = /app-ads\.txt|apple\.com|facebook|twitter|x\.com|instagram|youtube|linktr\.ee|notion\.site|docs\.google|sites\.google|\.web\.app\/?$|firebaseapp|github\.io\/?$|privacy|terms|policy/i;

// 「新着」フィードは更新が止まっているため、ランキング（無料 / 有料 / セールス）のうち最近リリースされたものを拾う
export async function fetchAppStore({ limit = 100, days = 45 } = {}) {
  const feeds = [
    `https://itunes.apple.com/jp/rss/topfreeapplications/limit=${limit}/genre=6014/json`,
    `https://itunes.apple.com/jp/rss/topgrossingapplications/limit=${limit}/genre=6014/json`,
    `https://itunes.apple.com/jp/rss/toppaidapplications/limit=${limit}/genre=6014/json`,
    `https://itunes.apple.com/jp/rss/newapplications/limit=${limit}/genre=6014/json`,
  ];
  const ids = new Set();
  for (const f of feeds) {
    try {
      const j = await fetchJson(f);
      for (const e of j.feed?.entry || []) {
        const id = e.id?.attributes?.["im:id"];
        if (id) ids.add(id);
      }
    } catch (e) {
      log("App Store feed failed:", f, e.message);
    }
  }
  const cutoff = Date.now() - days * 86400000;
  const out = [];
  const idList = [...ids];
  const dbg = { ids: idList.length, results: 0, games: 0, recent: 0 };
  for (let i = 0; i < idList.length; i += 50) {
    const chunk = idList.slice(i, i + 50);
    let res;
    try {
      res = await fetchJson(`https://itunes.apple.com/lookup?id=${chunk.join(",")}&country=jp&lang=ja_jp`);
    } catch (e) {
      log("App Store lookup failed:", e.message);
      continue;
    }
    for (const r of res.results || []) {
      dbg.results++;
      if (!(r.genres || []).includes("ゲーム")) continue;
      dbg.games++;
      if (!r.releaseDate || new Date(r.releaseDate).getTime() < cutoff) continue;
      dbg.recent++;
      const seller = r.sellerUrl && /^https?:\/\//.test(r.sellerUrl) && !APPSTORE_JUNK_URL.test(r.sellerUrl) ? cleanUrl(r.sellerUrl) : "";
      const storeUrl = r.trackViewUrl ? cleanUrl(r.trackViewUrl.split("?")[0]) : "";
      out.push({
        source: "App Store",
        sourceKind: "launch",
        sourceUrl: storeUrl,
        url: seller || storeUrl,
        title: r.trackName,
        description: truncate(`${r.artistName || ""} / ${(r.genres || []).filter((g) => g !== "ゲーム").slice(0, 2).join("・") || "ゲーム"} · App Store 新着`, 120),
        publishedAt: new Date(r.releaseDate).toISOString(),
        tags: ["ゲーム", "スマホ", "iOS", ...(r.genres || []).filter((g) => g !== "ゲーム").slice(0, 2)],
        phCategories: [],
        image: r.artworkUrl512 || r.artworkUrl100 || "",
        region: /ja/.test((r.languageCodesISO2A || []).join(",")) && /jp|日本/i.test(r.sellerName + " " + r.artistName + " " + (r.description || "").slice(0, 200)) ? "jp" : undefined,
      });
    }
  }
  log(`App Store: ${JSON.stringify(dbg)} -> ${out.length} items`);
  return out;
}

// ---------- itch.io 新着（海外インディーゲームのページ。既定では OFF） ----------
export async function fetchItchio() {
  const entries = parseFeed(await fetchText("https://itch.io/games/newest.xml"));
  return entries
    .filter((e) => e.link)
    .map((e) => ({
      source: "itch.io",
      sourceKind: "launch",
      sourceUrl: e.link,
      url: cleanUrl(e.link),
      title: e.title.replace(/\s*\[[^\]]*\]/g, "").trim(),
      description: truncate(stripTags(e.content), 200),
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      tags: ["ゲーム", "インディー", ...[...e.title.matchAll(/\[([^\]$]+)\]/g)].map((m) => m[1]).filter((t) => !/^\$|Free|Off/i.test(t)).slice(0, 3)],
      phCategories: [],
      image: firstImage(e.content),
    }));
}

export const SOURCES = {
  producthunt: (config, caches) => fetchProductHunt({ ...(config.producthunt || {}), _cache: caches?.producthunt }),
  hackernews: (config) => fetchHackerNews(config.hackernews || {}),
  onepagelove: () => fetchOnePageLove(),
  minimalgallery: () => fetchMinimalGallery(),
  launchingnext: () => fetchLaunchingNext(),
  pitchwall: () => fetchPitchWall(),
  muuuuu: () => fetchJpGallery("muuuuu"),
  sankou: () => fetchJpGallery("sankou"),
  io3000: () => fetchJpGallery("io3000"),
  webdesignclip: () => fetchJpGallery("webdesignclip"),
  oneguu: () => fetchJpGallery("oneguu"),
  responsivejp: () => fetchJpGallery("responsivejp"),
  fourgamer: () => fetchGameNews("fourgamer"),
  gamespark: () => fetchGameNews("gamespark"),
  insidegames: () => fetchGameNews("insidegames"),
  gamebusiness: () => fetchGameNews("gamebusiness"),
  denfami: () => fetchGameNews("denfami"),
  appbank: () => fetchGameNews("appbank"),
  applivgames: () => fetchGameNews("applivgames"),
  appstore: (config) => fetchAppStore(config.appstore || {}),
  itchio: () => fetchItchio(),
};
