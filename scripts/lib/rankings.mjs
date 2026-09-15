// ゲームに絞った「いま遊ばれているもの」のランキング。
//  - Steam: 公式 API の最多プレイ（同時接続ピーク・先週比の順位）
//  - App Store: 日本のゲーム無料ランキング（前日比の順位は自前で計算）
// どちらも順位の変動を出すことで「昨日まで無かったのに急に上がったタイトル」が分かるようにする。
import { fetchJson, log } from "./util.mjs";

const STEAM_MOST_PLAYED = "https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/";
const STEAM_APPDETAILS = "https://store.steampowered.com/api/appdetails";
const APPSTORE_TOPFREE = "https://itunes.apple.com/jp/rss/topfreeapplications/limit=100/genre=6014/json";

// 順位の動きを表示用にまとめる。
// 比較対象そのものが無い初回は、全件が NEW になって誤解を招くので変動を出さない
function delta(rank, prevRank, hasPrev = true) {
  if (!hasPrev) return { kind: "none", label: "", value: 0 };
  if (!prevRank) return { kind: "new", label: "NEW", value: 0 };
  const diff = prevRank - rank;
  if (diff > 0) return { kind: "up", label: `+${diff}`, value: diff };
  if (diff < 0) return { kind: "down", label: `${diff}`, value: diff };
  return { kind: "same", label: "–", value: 0 };
}

// ---------- Steam ----------
export async function fetchSteamRanking({ limit = 10, cache = {} } = {}) {
  const j = await fetchJson(STEAM_MOST_PLAYED, { timeoutMs: 20000 });
  const ranks = (j.response?.ranks || []).slice(0, limit);
  const names = (cache.steamNames = cache.steamNames || {});
  const out = [];

  for (const r of ranks) {
    const id = String(r.appid);
    // タイトル名と画像は変わらないので一度引いたら覚えておく
    if (!names[id]) {
      try {
        const d = await fetchJson(`${STEAM_APPDETAILS}?appids=${id}&cc=jp&l=japanese&filters=basic`, { timeoutMs: 15000 });
        const v = d?.[id];
        if (v?.success) names[id] = { name: v.data.name, image: v.data.header_image || "" };
        await new Promise((res) => setTimeout(res, 400));
      } catch (e) {
        log(`Steam appdetails failed (${id}): ${e.message}`);
      }
    }
    const info = names[id];
    if (!info) continue;
    out.push({
      rank: r.rank,
      title: info.name,
      image: info.image,
      url: `https://store.steampowered.com/app/${id}/`,
      metric: r.peak_in_game ? `同時接続 ${Number(r.peak_in_game).toLocaleString("ja-JP")}人` : "",
      delta: delta(r.rank, r.last_week_rank),
      deltaNote: "先週比",
    });
  }
  log(`Steam ranking: ${out.length} titles`);
  return out;
}

// ---------- App Store ----------
export async function fetchAppStoreRanking({ limit = 10, cache = {} } = {}) {
  const j = await fetchJson(APPSTORE_TOPFREE, { timeoutMs: 20000 });
  const entries = j.feed?.entry || [];
  const prev = cache.appstorePrev || {};
  const hasPrev = Object.keys(prev).length > 0;
  const today = {};
  const out = [];

  entries.forEach((e, i) => {
    const id = e.id?.attributes?.["im:id"];
    if (!id) return;
    const rank = i + 1;
    today[id] = rank;
    if (out.length >= limit) return;
    out.push({
      rank,
      title: e["im:name"]?.label || "",
      image: e["im:image"]?.at(-1)?.label || "",
      url: (e.link?.attributes?.href || "").split("?")[0],
      metric: e["im:artist"]?.label || "",
      delta: delta(rank, prev[id], hasPrev),
      deltaNote: "前日比",
    });
  });

  // 次回の比較用に今日の順位を丸ごと覚えておく（100 位まで持つと圏外からの浮上も拾える）
  cache.appstorePrev = today;
  cache.appstorePrevAt = new Date().toISOString();
  log(`App Store ranking: ${out.length} titles (前日データ ${Object.keys(prev).length} 件)`);
  return out;
}

export async function buildRankings(config, { cache = {} } = {}) {
  const cfg = config.rankings || {};
  const limit = cfg.limit ?? 10;
  const boards = [];

  if (cfg.steam !== false) {
    try {
      const items = await fetchSteamRanking({ limit, cache });
      if (items.length) {
        boards.push({
          id: "steam",
          label: "Steam",
          title: "いま遊ばれている",
          note: "Steam の同時接続数ランキング（先週比）",
          sourceUrl: "https://store.steampowered.com/charts/mostplayed",
          items,
        });
      }
    } catch (e) {
      log("Steam ranking failed:", e.message);
    }
  }

  if (cfg.appstore !== false) {
    try {
      const items = await fetchAppStoreRanking({ limit, cache });
      if (items.length) {
        boards.push({
          id: "appstore",
          label: "App Store",
          title: "無料ゲーム",
          note: "App Store（日本）の無料ゲームランキング（前日比）",
          sourceUrl: "https://apps.apple.com/jp/charts/iphone/%E3%82%B2%E3%83%BC%E3%83%A0-%E7%84%A1%E6%96%99%E3%82%A2%E3%83%97%E3%83%AA/6014?chart=top-free",
          items,
        });
      }
    } catch (e) {
      log("App Store ranking failed:", e.message);
    }
  }

  return { updatedAt: new Date().toISOString(), boards };
}
