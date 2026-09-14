// 社内閲覧向けの除外フィルタ（アダルト系キーワード / TLD / ホスト）

function wordRegex(word) {
  const w = word.toLowerCase();
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // ASCII の単語は単語境界で判定（"sex" が "sussex" に一致しないように）
  if (/^[a-z0-9+ ]+$/.test(w)) return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return new RegExp(escaped, "i");
}

export function createBlockChecker(blocklist) {
  const words = (blocklist.words || []).map(wordRegex);
  const tlds = (blocklist.tlds || []).map((t) => t.toLowerCase());
  const hosts = (blocklist.hosts || []).map((h) => h.toLowerCase());

  return function check(item) {
    let host = "";
    try {
      host = new URL(item.url).hostname.toLowerCase();
    } catch {
      return { blocked: true, reason: "invalid url" };
    }
    for (const t of tlds) if (host.endsWith(t)) return { blocked: true, reason: `tld ${t}` };
    for (const h of hosts) if (host === h || host.endsWith("." + h)) return { blocked: true, reason: `host ${h}` };

    const text = [item.title, item.description, item.url, ...(item.tags || [])].join(" \n ").toLowerCase();
    for (let i = 0; i < words.length; i++) {
      if (words[i].test(text)) return { blocked: true, reason: `word "${blocklist.words[i]}"` };
    }
    return { blocked: false };
  };
}
