// 掲載する URL を「公式サイト（作品）のトップ」に寄せ、ゲーム以外のサイトを除外する

// 記事・お知らせの一覧パス。これらのセグメントが現れたら、その手前までをサイトの入口とみなす
const DEFAULT_ARTICLE_SEGMENTS = [
  "news", "topics", "press", "pressrelease", "blog", "article", "articles",
  "announcement", "announcements", "notice", "information", "column", "interview", "report",
];

// 言語・地域のセグメントはトップページの一部として残す
const LOCALE_SEGMENT = /^(ja|jp|en|ja-jp|en-us|en-gb|zh|zh-cn|zh-tw|ko|kr|ja_jp|en_us|jp-ja|global|world|home|index(\.html?)?|top)$/i;

// URL をたどってサイト（作品）のトップに寄せる
export function toSiteRoot(input, { articleSegments = DEFAULT_ARTICLE_SEGMENTS } = {}) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  // ストアページは個別ページのままで意味があるので触らない
  if (/apps\.apple\.com|play\.google\.com|store\.steampowered\.com|store-jp\.nintendo\.com|itch\.io/.test(u.hostname)) {
    return input;
  }

  const segs = u.pathname.split("/").filter(Boolean);
  const set = new Set(articleSegments.map((s) => s.toLowerCase()));
  const cut = segs.findIndex((s) => set.has(s.toLowerCase().replace(/\.(php|html?|aspx)$/, "")));
  u.hash = "";
  // 記事セグメントが無ければパスはそのまま（index.html などのファイル名に "/" を足すと 404 になる）
  if (cut < 0) return u.toString();

  const kept = segs.slice(0, cut);
  u.pathname = kept.length ? "/" + kept.join("/") + "/" : "/";
  u.search = "";
  return u.toString();
}

// 重複判定用のキー。https/http・www・末尾の言語セグメントの違いを同じサイトとして扱う
export function canonicalKey(input) {
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const segs = u.pathname.split("/").filter(Boolean);
    while (segs.length && LOCALE_SEGMENT.test(segs[segs.length - 1])) segs.pop();
    return host + "/" + segs.join("/") + (u.search || "");
  } catch {
    return input;
  }
}

export function createSiteFilter(cfg = {}) {
  const hosts = (cfg.excludeHosts || []).map((h) => h.toLowerCase());
  const prefixes = (cfg.excludeHostPrefixes || []).map((p) => p.toLowerCase());
  const urlPatterns = (cfg.excludeUrlPatterns || []).map((p) => new RegExp(p, "i"));
  const hostPatterns = (cfg.excludeHostPatterns || []).map((p) => new RegExp(p, "i"));
  const merch = (cfg.merchWords || []).map((w) => new RegExp(w, "i"));
  const gameSignals = (cfg.gameSignals || []).map((w) => new RegExp(w, "i"));
  const updateOnly = (cfg.updateOnlyWords || []).map((w) => new RegExp(w, "i"));
  const novelty = (cfg.noveltySignals || []).map((w) => new RegExp(w, "i"));
  const gameHostRe = cfg.gameHostPattern ? new RegExp(cfg.gameHostPattern, "i") : null;

  // 除外するホストか（EC・アニメ・TV 局・ニュース/プレス用サブドメインなど）
  function excludedHost(url) {
    let host;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return "invalid url";
    }
    for (const h of hosts) if (host === h || host.endsWith("." + h)) return `host ${h}`;
    for (const p of prefixes) if (host.startsWith(p)) return `subdomain ${p}`;
    // 映画・展覧会など、ゲーム以外の公式サイトを URL の形から判定する
    // （ゲーム系ドメインに当てはまるものは除外しない）
    if (!(gameHostRe && gameHostRe.test(host))) {
      for (const re of hostPatterns) if (re.test(host)) return `host pattern ${re.source.slice(0, 16)}`;
      for (const re of urlPatterns) if (re.test(url)) return `url ${re.source.slice(0, 16)}`;
    }
    return null;
  }

  // グッズ・アニメ・イベントのみの記事から拾ったリンクを落とす
  // （リンク先がゲーム公式ドメインらしい場合は残す）
  function merchOnly(item) {
    const text = `${item.title || ""} ${item.headline || ""} ${item.description || ""}`;
    if (!merch.some((re) => re.test(text))) return null;
    const host = (() => {
      try {
        return new URL(item.url).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    if (gameHostRe && gameHostRe.test(host)) return null;
    if (gameSignals.some((re) => re.test(text))) return null;
    return "merch/anime only";
  }

  // 海外のローンチ系（Show HN など）はゲーム以外の個人プロダクトが混ざりやすいので、
  // OGP の説明まで揃った時点でゲームらしさを確認する
  function launchWithoutGameSignal(item) {
    if (!cfg.requireGameSignalForLaunch) return null;
    if (item.sourceKind !== "launch" || item.source === "App Store") return null;
    if (!item.description) return null; // OGP 未取得のうちは判定しない
    const text = `${item.title || ""} ${item.description || ""} ${(item.tags || []).join(" ")}`;
    return gameSignals.some((re) => re.test(text)) ? null : "launch without game signal";
  }

  // 運営中タイトルの細かい更新（Ver.アップ・新イベント・ガチャなど）の記事は
  // 「新しく公開されたサイト」ではないので載せない。新規性を示す語があれば残す
  function updateOnlyArticle(item) {
    if (item.sourceKind !== "news" || !updateOnly.length) return null;
    const text = `${item.title || ""} ${item.headline || ""}`;
    if (!updateOnly.some((re) => re.test(text))) return null;
    if (novelty.some((re) => re.test(text))) return null;
    return "update only";
  }

  return function check(item) {
    return excludedHost(item.url) || merchOnly(item) || updateOnlyArticle(item) || launchWithoutGameSignal(item);
  };
}
