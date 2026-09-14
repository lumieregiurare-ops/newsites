// App Store（日本）でタイトル名を検索し、予約注文中（releaseDate が未来）のアプリを見つける。
// Apple の検索 API はレート制限が厳しいため、間隔を空けて逐次実行し結果をキャッシュする。
import { fetchJson, log, cleanUrl } from "./util.mjs";

const SEARCH = "https://itunes.apple.com/search";
const LOOKUP = "https://itunes.apple.com/lookup";

// 検索語を作る: 記号や副題を落として本体名だけにする
export function searchTerm(title) {
  return title
    .replace(/[『』「」【】〜～:：・／/]/g, " ")
    .replace(/\s*[-–—]\s*.*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[！!？?。、,.・:：〜～\-－ー—–_'"'']/g, "")
    .replace(/[ぁ-ん]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); // ひらがな→カタカナ
}

// タイトルが一致しているか（部分一致でも、短すぎる語での誤ヒットは弾く）
function titleMatches(query, trackName) {
  const a = normalize(query);
  const b = normalize(trackName);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < 4) return false;
  return b.includes(a) || a.includes(b);
}

export function toEntry(r) {
  const release = r.releaseDate ? new Date(r.releaseDate) : null;
  return {
    trackId: String(r.trackId),
    title: r.trackName,
    artist: r.artistName || "",
    genres: (r.genres || []).filter((g) => g !== "ゲーム").slice(0, 3),
    releaseDate: r.releaseDate || "",
    isPreorder: !!release && release.getTime() > Date.now(),
    storeUrl: r.trackViewUrl ? cleanUrl(r.trackViewUrl.split("?")[0]) : "",
    sellerUrl: r.sellerUrl && /^https?:\/\//.test(r.sellerUrl) ? cleanUrl(r.sellerUrl) : "",
    image: r.artworkUrl512 || r.artworkUrl100 || "",
    isGame: (r.genres || []).includes("ゲーム"),
  };
}

// タイトル一覧を検索して、見つかったものを返す（cache は呼び出し側が保存する）
export async function searchTitles(titles, { cache = {}, delayMs = 3000, max = 40, ttlHours = 72 } = {}) {
  const out = new Map();
  const now = Date.now();
  let searched = 0;
  let blocked = 0;

  for (const title of titles) {
    const term = searchTerm(title);
    if (!term || term.length < 2) continue;

    const hit = cache[term];
    if (hit && now - new Date(hit.at).getTime() < ttlHours * 3600000) {
      if (hit.entry) out.set(title, hit.entry);
      continue;
    }
    if (searched >= max || blocked >= 3) continue;

    searched++;
    try {
      const j = await fetchJson(
        `${SEARCH}?term=${encodeURIComponent(term)}&country=jp&media=software&entity=software&limit=5&lang=ja_jp`,
        { timeoutMs: 15000 }
      );
      const match = (j.results || []).map(toEntry).find((e) => e.isGame && titleMatches(term, e.title));
      cache[term] = { at: new Date().toISOString(), entry: match || null };
      if (match) out.set(title, match);
      blocked = 0;
    } catch (e) {
      blocked++;
      log(`App Store search failed (${term}): ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  log(`App Store search: ${searched} queries, ${out.size} matched`);
  return out;
}

// すでに分かっている trackId の最新状態を取り直す（予約 → 配信済みの変化を検出）
export async function lookupIds(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const j = await fetchJson(`${LOOKUP}?id=${ids.slice(i, i + 50).join(",")}&country=jp&lang=ja_jp`, { timeoutMs: 20000 });
      for (const r of j.results || []) out.set(String(r.trackId), toEntry(r));
    } catch (e) {
      log("App Store lookup failed:", e.message);
    }
  }
  return out;
}
