// 全ページ共通: 日付・リンクの整形、ニュース行やサイドバーの描画、ヘッダーの状態
(() => {
  const GL = (window.GL = {});
  const base = document.body.dataset.base || "";
  const $ = (s, root = document) => root.querySelector(s);
  GL.$ = $;
  GL.base = base;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  // 外部リンクの属性。URL が不正なら href を付けない
  const ext = (u) => (safeUrl(u) ? ` href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : "");
  GL.esc = esc;
  GL.safeUrl = safeUrl;
  GL.ext = ext;

  GL.getJson = async (path) => {
    const r = await fetch(`${base}${path}?t=${Math.floor(Date.now() / 600000)}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };

  // ---------- 日付（すべて日本時間で表示する） ----------
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const pad = (n) => String(n).padStart(2, "0");
  function jst(t) {
    const d = new Date(new Date(t).getTime() + 9 * 3600000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
  }
  GL.WD = WD;
  GL.jst = jst;
  GL.dayKey = (t) => {
    const p = jst(t);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  };
  GL.dayLabel = (t) => {
    const p = jst(t);
    return `${p.y}年${p.m}月${p.d}日（${WD[p.w]}）`;
  };
  GL.clock = (t) => {
    const p = jst(t);
    return `${pad(p.hh)}:${pad(p.mm)}`;
  };
  GL.stamp = (t) => {
    const p = jst(t);
    return `${p.m}/${p.d} ${pad(p.hh)}:${pad(p.mm)}`;
  };
  GL.relTime = (t) => {
    const diff = (Date.now() - new Date(t).getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
    const p = jst(t);
    return `${p.m}/${p.d}`;
  };
  // "2026-10-05" のような日付だけの文字列を、日本時間の暦日として扱う
  GL.dateParts = (ymd) => {
    const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
    const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { y, m, d, w };
  };
  GL.daysUntil = (ymd) => {
    const { y, m, d } = GL.dateParts(ymd);
    const today = jst(Date.now());
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000);
  };

  // ---------- 前回の訪問（NEW 表示用。この端末の localStorage にだけ置く） ----------
  const VISIT_KEY = "gamelab:visit";
  const VISIT_GAP_MS = 30 * 60 * 1000;
  const lastVisit = (() => {
    const now = Date.now();
    try {
      const raw = JSON.parse(localStorage.getItem(VISIT_KEY) || "null");
      const touched = raw && typeof raw.touched === "number" ? raw.touched : null;
      const prev = touched == null ? null : now - touched > VISIT_GAP_MS ? touched : raw.base ?? touched;
      localStorage.setItem(VISIT_KEY, JSON.stringify({ base: prev, touched: now }));
      return prev;
    } catch {
      return null;
    }
  })();
  GL.isNew = (it) => lastVisit != null && new Date(it.addedAt).getTime() > lastVisit;

  // ---------- 機種・カテゴリ ----------
  const PLATFORM = {
    switch: "Switch",
    switch2: "Switch 2",
    ps: "PS",
    xbox: "Xbox",
    pc: "PC",
    mobile: "スマホ",
    browser: "ブラウザ",
    arcade: "AC",
    vr: "VR",
  };
  GL.PLATFORM_NAME = {
    switch: "Nintendo Switch",
    switch2: "Nintendo Switch 2",
    ps: "PlayStation",
    xbox: "Xbox",
    pc: "PC",
    mobile: "スマホ",
    browser: "ブラウザ",
    arcade: "アーケード",
    vr: "VR",
  };
  GL.pfTags = (ids, limit = 4) =>
    (ids || [])
      .slice(0, limit)
      .map((id) => `<span class="pf pf-${esc(id)}">${esc(PLATFORM[id] || id)}</span>`)
      .join("");

  const CATEGORY = {
    teaser: "ティザー",
    prereg: "事前登録",
    anniversary: "周年",
    campaign: "キャンペーン",
    event: "イベント",
    release: "発売・配信",
    indie: "インディー",
    browser: "ブラウザゲーム",
    company: "業界",
    media: "メディア",
    goods: "グッズ",
    official: "新作情報",
  };
  GL.CATEGORY = CATEGORY;

  const hostOf = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  GL.hostOf = hostOf;

  // sites.json の 1 件を、ニュース行として出す形にそろえる
  GL.norm = (it) => {
    const src = it.sources?.[0] || { name: it.source, url: it.url };
    const isStore = it.source === "App Store" || /App Store 新着$/.test(it.headline || "");
    const isNews = !!it.headline && !isStore && it.source !== "minimal.gallery";
    const title = isNews ? it.headline : it.title;
    let lead = isStore ? (it.headline || it.description || "").replace(/\s*·\s*App Store 新着$/, "") : it.description || "";
    if (lead === title) lead = "";
    const link = safeUrl(src.url) || safeUrl(it.url);
    const official = safeUrl(it.url);
    return {
      id: it.id,
      title,
      name: it.title,
      lead,
      link,
      official: official && hostOf(official) !== hostOf(link) ? official : "",
      officialHost: hostOf(official),
      sourceName: src.name,
      sourceNames: (it.sources || []).map((s) => s.name),
      image: safeUrl(it.image),
      label: isStore ? "新作アプリ" : CATEGORY[it.categories?.[0]] || "ニュース",
      categories: it.categories || [],
      platforms: it.platforms || [],
      region: it.region,
      tags: it.tags || [],
      host: it.host,
      publishedAt: it.publishedAt,
      addedAt: it.addedAt,
      isNews,
      isStore,
      raw: it,
    };
  };

  // ---------- サムネイル ----------
  GL.thumb = (src, extra = "") =>
    src
      ? `<span class="thumb${extra}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`
      : `<span class="thumb noimg${extra}"></span>`;

  // 読み込めなかった画像は枠だけにし、正方形の画像（アプリアイコン）は切らずに収める
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img.tagName !== "IMG") return;
      const box = img.closest(".thumb, .rank-thumb");
      if (!box) return;
      box.classList.add("noimg");
      img.remove();
    },
    true
  );
  document.addEventListener(
    "load",
    (e) => {
      const img = e.target;
      if (img.tagName !== "IMG" || !img.naturalWidth) return;
      const r = img.naturalWidth / img.naturalHeight;
      if (r > 0.8 && r < 1.25) img.closest(".thumb")?.classList.add("is-square");
    },
    true
  );

  // ---------- ニュース 1 行 ----------
  GL.newsRow = (n, { fav = false, faved = false, clock = true } = {}) => {
    const more = n.sourceNames.length > 1 ? ` ほか${n.sourceNames.length - 1}` : "";
    const when = clock ? GL.clock(n.publishedAt) : GL.stamp(n.publishedAt);
    return `<article class="nrow" data-id="${esc(n.id)}">
  <a class="nrow-thumb"${ext(n.link)} tabindex="-1" aria-hidden="true">${GL.thumb(n.image)}</a>
  <div class="nrow-body">
    <div class="nrow-label"><span class="cat">${esc(n.label)}</span>${GL.pfTags(n.platforms)}${GL.isNew(n) ? '<span class="new-mark">NEW</span>' : ""}</div>
    <h3 class="nrow-title"><a${ext(n.link)}>${esc(n.title)}</a></h3>
    ${n.lead ? `<p class="nrow-lead">${esc(n.lead)}</p>` : ""}
    <div class="nrow-meta">
      <span class="src" title="${esc(n.sourceNames.join(" / "))}">${esc(n.sourceName)}${more}</span>
      <time datetime="${esc(n.publishedAt)}">${when}</time>
      ${n.official ? `<a class="rel"${ext(n.official)} title="関連サイト">${esc(n.officialHost)}</a>` : ""}
      ${fav ? `<button class="fav${faved ? " on" : ""}" type="button" data-fav="${esc(n.id)}" aria-pressed="${faved}" aria-label="お気に入り">★</button>` : ""}
    </div>
  </div>
</article>`;
  };

  // 日付の見出しを挟んで並べる
  GL.newsList = (items, opts) => {
    let html = "";
    let day = "";
    for (const n of items) {
      const k = GL.dayKey(n.publishedAt);
      if (k !== day) {
        day = k;
        html += `<h3 class="date-head">${GL.dayLabel(n.publishedAt)}</h3>`;
      }
      html += GL.newsRow(n, typeof opts === "function" ? opts(n) : opts);
    }
    return html;
  };

  // サムネイル付きの小さな行（機種別タブなど）
  GL.miniRow = (n) => `<a class="mini"${ext(n.link)}>
  ${GL.thumb(n.image)}
  <div>
    <p class="mini-title">${esc(n.title)}</p>
    <div class="mini-meta">${GL.pfTags(n.platforms, 3)}<span>${esc(n.sourceName)}</span><span>${GL.stamp(n.publishedAt)}</span></div>
  </div>
</a>`;

  // ---------- サイドバー ----------
  GL.renderRanking = async (box) => {
    if (!box) return;
    let data;
    try {
      data = await GL.getJson("data/rankings.json");
    } catch {
      box.hidden = true;
      return;
    }
    const boards = data?.boards || [];
    if (!boards.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<h2 class="side-title">ランキング</h2>
  <div class="rank-tabs" role="tablist">${boards
    .map((b, i) => `<button type="button" role="tab" data-i="${i}">${esc(b.label)}<small>${esc(b.title)}</small></button>`)
    .join("")}</div>
  <ol class="rank-list"></ol>
  <p class="side-note"></p>`;
    const list = $(".rank-list", box);
    const note = $(".side-note", box);
    const draw = (i) => {
      const b = boards[i];
      box.querySelectorAll(".rank-tabs button").forEach((el, j) => {
        el.classList.toggle("active", i === j);
        el.setAttribute("aria-selected", String(i === j));
      });
      list.classList.toggle("is-square", !!b.square);
      list.innerHTML = b.items
        .slice(0, 10)
        .map((it) => {
          const d = it.delta || { kind: "none", label: "" };
          return `<li>
  <span class="rank-no">${esc(it.rank)}</span>
  <a class="rank-thumb"${ext(it.url)} tabindex="-1" aria-hidden="true">${safeUrl(it.image) ? `<img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</a>
  <div><a class="rank-name"${ext(it.url)}>${esc(it.title)}</a><div class="rank-metric">${esc(it.metric || "")}</div></div>
  <span class="rank-delta is-${esc(d.kind)}" title="${esc(it.deltaNote || "")}">${d.kind === "none" ? "" : d.kind === "same" ? "→" : esc(d.label)}</span>
</li>`;
        })
        .join("");
      note.innerHTML = `${esc(b.note)}。出典: <a${ext(b.sourceUrl)}>${esc(b.label)}</a>`;
    };
    box.querySelectorAll(".rank-tabs button").forEach((el) => el.addEventListener("click", () => draw(Number(el.dataset.i))));
    draw(0);
  };

  // 発売スケジュール（直近分を日付ごとに）
  GL.renderScheduleBox = (box, sched, limit = 12) => {
    if (!box) return;
    const rows = (sched?.releases || [])
      .filter((r) => r.date && GL.daysUntil(r.date) >= 0)
      .slice()
      .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.sortKey.localeCompare(b.sortKey))
      .slice(0, limit)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    let html = `<h2 class="side-title">発売スケジュール<a href="${base}schedule/">すべて見る</a></h2>`;
    if (!rows.length) {
      box.innerHTML = html + `<p class="side-empty">直近の発売予定はありません。</p>`;
      return;
    }
    let day = "";
    for (const r of rows) {
      if (r.date !== day) {
        if (day) html += `</div>`;
        day = r.date;
        const p = GL.dateParts(r.date);
        const until = GL.daysUntil(r.date);
        const soon = until === 0 ? "今日" : until === 1 ? "明日" : until <= 7 ? `あと${until}日` : "";
        html += `<div class="sched-day"><p class="sched-day-head">${p.m}月${p.d}日（${WD[p.w]}）${soon ? `<span class="soon${until > 1 ? " later" : ""}">${soon}</span>` : ""}</p>`;
      }
      html += `<a class="sched-item"${ext(r.url)}><p class="sched-item-title">${esc(r.title)}</p>${
        r.platforms?.length ? `<div class="sched-item-meta">${GL.pfTags(r.platforms)}</div>` : ""
      }</a>`;
    }
    box.innerHTML = html + `</div>`;
  };

  GL.renderPreregBox = (box, list, limit = 6) => {
    if (!box) return;
    const items = [...(list || [])].sort((a, b) => (a.verified === false ? 1 : 0) - (b.verified === false ? 1 : 0)).slice(0, limit);
    let html = `<h2 class="side-title">事前登録受付中<a href="${base}prereg/">すべて見る</a></h2>`;
    if (!items.length) {
      box.innerHTML = html + `<p class="side-empty">受付中のタイトルはありません。</p>`;
      return;
    }
    html += items
      .map(
        (p) => `<a class="sched-item"${ext(p.url)}><p class="sched-item-title">${esc(p.title)}</p><div class="sched-item-meta">${GL.pfTags(p.platforms)}<span class="rel-date${
          p.releaseText ? "" : " is-tba"
        }">${esc(p.releaseText ? `${p.releaseText} 配信予定` : "配信日未定")}</span></div></a>`
      )
      .join("");
    box.innerHTML = html;
  };

  // 事前登録カード。full のときは特典・記事見出し・各種リンクまで出す
  GL.preregCard = (p, { full = false } = {}) => {
    const unverified = p.verified === false;
    const rel = p.releaseText
      ? `<span class="rel-date" title="${p.releaseSource === "appstore" ? "App Store の予約ページに表示されている配信予定日" : "記事で発表された配信時期"}">${esc(p.releaseText)}配信予定</span>`
      : `<span class="rel-date is-tba">配信日未定</span>`;
    let html = `<article class="pcard">
  <a class="thumb-link"${ext(p.url)}>
    ${GL.thumb(safeUrl(p.image))}
    <span class="pcard-badge${unverified ? " is-unverified" : ""}"${unverified ? ' title="App Store では確認できていないタイトルです（Android 先行の可能性があります）"' : ""}>事前登録</span>
  </a>
  <h3 class="pcard-title"><a${ext(p.url)}>${esc(p.title)}</a></h3>
  <div class="pcard-meta">${GL.pfTags(p.platforms)}${rel}</div>
  ${p.count ? `<p class="pcard-count">${esc(p.count)}</p>` : ""}`;
    if (full) {
      if (p.reward) html += `<p class="pcard-reward">特典: ${esc(p.reward)}</p>`;
      if (p.headline) html += `<a class="pcard-headline"${ext(p.sourceUrl || p.url)}>${esc(p.headline)}</a>`;
      const links = [];
      if (safeUrl(p.url)) links.push(`<a${ext(p.url)}>${unverified && !p.officialKnown ? `${esc(p.source)}で見る` : "公式サイト"}</a>`);
      if (p.appStore?.url) links.push(`<a class="is-store"${ext(p.appStore.url)}>${p.appStore.preorder ? "App Storeで予約" : "App Store"}</a>`);
      if (links.length) html += `<div class="pcard-links">${links.join("")}</div>`;
    }
    return html + `</article>`;
  };

  GL.changeItem = (c) => {
    const sub = c.from && c.to ? `${c.from} → ${c.to}` : c.to || "";
    return `<li><a${ext(c.url)}>
  <span class="ch-badge ch-${esc(c.type)}">${esc(c.label)}</span>
  <span class="ch-title">${esc(c.title)}</span>
  <span class="ch-sub">${sub ? `${esc(sub)} · ` : ""}${GL.relTime(c.at)}</span>
</a></li>`;
  };

  GL.renderChangesBox = (box, changes, limit = 6) => {
    if (!box) return;
    const list = (changes || []).filter((c) => c.type !== "new").slice(0, limit);
    const items = list.length ? list : (changes || []).slice(0, limit);
    if (!items.length) {
      box.hidden = true;
      return;
    }
    box.innerHTML = `<h2 class="side-title">発売日・事前登録の動き<a href="${base}schedule/#changes">履歴</a></h2><ul class="changes">${items
      .map(GL.changeItem)
      .join("")}</ul>`;
  };

  GL.renderCategoryBox = (box, data, { active = "", onPick } = {}) => {
    if (!box) return;
    const cats = (data?.categories || []).filter((c) => c.count > 0);
    box.innerHTML = `<h2 class="side-title">ジャンル別</h2><ul class="cat-list">${cats
      .map(
        (c) =>
          `<li><a href="${base}radar/?category=${esc(c.id)}" data-cat="${esc(c.id)}"${c.id === active ? ' class="active"' : ""}><span>${esc(
            CATEGORY[c.id] || c.label
          )}</span><span class="n">${c.count}</span></a></li>`
      )
      .join("")}</ul>`;
    if (onPick) {
      box.querySelectorAll("a[data-cat]").forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          onPick(a.dataset.cat);
        })
      );
    }
  };

  // ---------- ヘッダー ----------
  {
    const t = jst(Date.now());
    const today = $("#today");
    if (today) today.textContent = `${t.y}年${t.m}月${t.d}日（${WD[t.w]}）`;
    document.querySelectorAll(".js-year").forEach((el) => (el.textContent = t.y));

    // 今いるページのメニューを強調
    const page = document.body.dataset.page;
    const q = new URLSearchParams(location.search);
    const key = page === "news" && q.get("platform") ? q.get("platform") : page;
    const cur = document.querySelector(`.gnav a[data-nav="${key}"]`) || document.querySelector(`.gnav a[data-nav="${page}"]`);
    if (cur) {
      cur.setAttribute("aria-current", "page");
      // スマホで横にスクロールするメニューは、選ばれている項目が見える位置に寄せる
      const nav = cur.parentElement;
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - 16;
    }

    const searchBox = $(".search input");
    if (searchBox && page === "news") searchBox.value = q.get("q") || q.get("query") || "";

    const toTop = $("#toTop");
    if (toTop) {
      const onScroll = () => (toTop.hidden = window.scrollY < 700);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    }

    GL.getJson("data/site.json")
      .then((site) => {
        document.querySelectorAll(".js-x").forEach((a) => {
          if (safeUrl(site.x)) a.href = site.x;
          else a.hidden = true;
        });
      })
      .catch(() => {});
  }
})();
