// note の公式 RSS（https://note.com/<user>/rss）から自分の記事一覧を取る。
// 本文は転載せず、タイトル・サムネイル・冒頭の要約・リンクだけを保存する
import { fetchText, log, truncate } from "./util.mjs";
import { parseFeed, stripTags } from "./xml.mjs";

export async function fetchNoteArticles(noteUrl, { limit = 12 } = {}) {
  const m = (noteUrl || "").match(/note\.com\/([A-Za-z0-9_]+)/);
  if (!m) return null;
  const user = m[1];
  const xml = await fetchText(`https://note.com/${user}/rss`, { timeoutMs: 20000 });
  const channelTitle = (xml.match(/<channel>[\s\S]*?<title>([^<]*)<\/title>/) || [])[1] || "";
  const blocks = xml.split(/<item>/).slice(1);
  const items = parseFeed(xml).slice(0, limit).map((e, i) => {
    const raw = blocks[i] || "";
    const thumb = (raw.match(/<media:thumbnail>([^<]+)<\/media:thumbnail>/) || [])[1] || "";
    return {
      title: e.title,
      url: e.link,
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      image: thumb.trim(),
      summary: truncate(stripTags(e.description || e.content || "").replace(/続きをみる\s*$/, ""), 90),
    };
  });
  log(`note @${user}: ${items.length} articles`);
  return { user, url: `https://note.com/${user}`, title: channelTitle, updatedAt: new Date().toISOString(), items };
}
