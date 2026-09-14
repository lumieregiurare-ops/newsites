(() => {
  const FAV_KEY = "newsites:favorites";
  const STATE_KEY = "newsites:state";
  const PAGE_SIZE = 24;
  const SOURCE_COLORS = {
    "Product Hunt": "#da552f",
    "Hacker News": "#ff6600",
    "One Page Love": "#2f6fed",
    "minimal.gallery": "#111111",
    "Launching Next": "#28a745",
    "PitchWall": "#7c3aed",
    "MUUUUU.ORG": "#e8b400",
    "SANKOU!": "#0ea5e9",
    "I/O 3000": "#334155",
    "Web Design Clip": "#16a34a",
    "1guu": "#f97316",
    "Responsive Web Design JP": "#0891b2",
    "4Gamer": "#c62828",
    "Game*Spark": "#1565c0",
    "Inside": "#6a1b9a",
    "GameBusiness.jp": "#00838f",
    "電ファミニコゲーマー": "#ef6c00",
    "itch.io": "#fa5c5c",
  };
  const SOURCE_URLS = {
    "GameBusiness.jp": "https://www.gamebusiness.jp/",
    "電ファミニコゲーマー": "https://news.denfaminicogamer.jp/",
    "Product Hunt": "https://www.producthunt.com/topics/games",
    "Hacker News": "https://news.ycombinator.com/show",
    "One Page Love": "https://onepagelove.com/",
    "minimal.gallery": "https://minimal.gallery/",
    "Launching Next": "https://www.launchingnext.com/",
    "PitchWall": "https://pitchwall.co/",
    "MUUUUU.ORG": "https://muuuuu.org/",
    "SANKOU!": "https://sankoudesign.com/",
    "I/O 3000": "https://io3000.com/",
    "Web Design Clip": "https://webdesignclip.com/",
    "1guu": "https://1guu.jp/",
    "Responsive Web Design JP": "https://responsive-jp.com/",
    "4Gamer": "https://www.4gamer.net/",
    "Game*Spark": "https://www.gamespark.jp/",
    "Inside": "https://www.inside-games.jp/",
    "itch.io": "https://itch.io/",
  };

  const $ = (sel) => document.querySelector(sel);
  const grid = $("#grid");
  const tpl = $("#cardTpl");

  let data = { items: [], categories: [], sources: [], site: {} };
  let favorites = load(FAV_KEY, {});
  let page = 1;
  const state = Object.assign(
    { category: "all", source: "all", region: "all", platform: "all", period: "30", sort: "new", query: "", favOnly: false },
    load(STATE_KEY, {})
  );

  function load(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  // ---------- helpers ----------
  function relTime(iso) {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}日前`;
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  }
  function hashHue(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function labelOf(id) {
    return data.categories.find((c) => c.id === id)?.label || id;
  }
  function matchesBase(it) {
    if (state.source !== "all" && !it.sources.some((s) => s.name === state.source)) return false;
    if (state.region !== "all" && (it.region || "global") !== state.region) return false;
    if (state.platform !== "all" && !(it.platforms || []).includes(state.platform)) return false;
    if (!state.favOnly && state.period !== "all") {
      const since = Date.now() - Number(state.period) * 86400000;
      if (new Date(it.publishedAt).getTime() < since) return false;
    }
    return true;
  }

  // ---------- favorites ----------
  const isFav = (id) => !!favorites[id];
  function toggleFav(item) {
    if (favorites[item.id]) delete favorites[item.id];
    else favorites[item.id] = { ...item, savedAt: new Date().toISOString() };
    save(FAV_KEY, favorites);
    $("#favCount").textContent = Object.keys(favorites).length;
  }

  // ---------- filtering ----------
  function baseItems() {
    if (!state.favOnly) return data.items;
    const ids = new Set(data.items.map((i) => i.id));
    return [...data.items.filter((i) => isFav(i.id)), ...Object.values(favorites).filter((f) => !ids.has(f.id))];
  }

  function visibleItems() {
    const q = state.query.trim().toLowerCase();
    const items = baseItems().filter((it) => {
      if (!matchesBase(it)) return false;
      if (state.category !== "all" && !it.categories.includes(state.category)) return false;
      if (q) {
        const hay = `${it.title} ${it.description} ${it.host} ${(it.tags || []).join(" ")} ${it.categories.map(labelOf).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorters = {
      new: (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
      points: (a, b) => (b.points || 0) - (a.points || 0) || new Date(b.publishedAt) - new Date(a.publishedAt),
      title: (a, b) => a.title.localeCompare(b.title, "ja"),
    };
    return items.sort(sorters[state.sort] || sorters.new);
  }

  // ---------- rendering ----------
  function renderHero() {
    const week = Date.now() - 7 * 86400000;
    const set = (k, v) => ($(`[data-stat="${k}"]`).innerHTML = v);
    set("total", data.total ?? data.items.length);
    set("jp", data.regions?.jp ?? data.items.filter((i) => i.region === "jp").length);
    set("week", data.items.filter((i) => new Date(i.addedAt).getTime() > week).length);
    const u = new Date(data.updatedAt);
    set("updated", `${u.getMonth() + 1}/${u.getDate()}<small> ${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}</small>`);
  }

  function renderCategories() {
    const nav = $("#categoryNav");
    const counts = { all: 0 };
    for (const it of baseItems()) {
      if (!matchesBase(it)) continue;
      counts.all++;
      for (const c of it.categories) counts[c] = (counts[c] || 0) + 1;
    }
    nav.innerHTML = "";
    for (const c of [{ id: "all", label: "すべて" }, ...data.categories]) {
      if (c.id !== "all" && !counts[c.id] && state.category !== c.id) continue;
      const b = document.createElement("button");
      b.className = "chip" + (state.category === c.id ? " active" : "");
      b.innerHTML = `${c.label} <span class="n">${counts[c.id] || 0}</span>`;
      b.addEventListener("click", () => setState({ category: c.id }));
      nav.appendChild(b);
    }
  }

  function renderSources() {
    const sel = $("#sourceSelect");
    sel.innerHTML = `<option value="all">すべて</option>` + data.sources.map((s) => `<option value="${s}">${s}</option>`).join("");
    sel.value = data.sources.includes(state.source) ? state.source : "all";
    state.source = sel.value;

    const list = $("#sourceList");
    list.innerHTML = data.sources
      .map((s) => `<li><a href="${SOURCE_URLS[s] || "#"}" target="_blank" rel="noopener noreferrer">${s}</a></li>`)
      .join("");

    const psel = $("#platformSelect");
    const platforms = (data.platforms || []).filter((p) => p.count > 0);
    psel.innerHTML = `<option value="all">すべて</option>` + platforms.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
    psel.value = platforms.some((p) => p.id === state.platform) ? state.platform : "all";
    state.platform = psel.value;
  }

  function renderBrand() {
    const t = data.site?.title;
    if (!t) return;
    $("#brandName").textContent = t;
    $("#footerBrand").textContent = t;
  }

  function renderFooter() {
    $("#year").textContent = new Date().getFullYear();
    const c = $("#contact");
    if (data.site?.contactUrl) {
      c.innerHTML = `<a href="${data.site.contactUrl}" target="_blank" rel="noopener noreferrer">${data.site.contactLabel || "お問い合わせ"}</a>`;
    } else {
      c.textContent = "お問い合わせ先: サイト管理者まで";
    }
  }

  function makeCard(item) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const thumb = node.querySelector(".thumb");
    const img = thumb.querySelector("img");
    const fb = thumb.querySelector(".thumb-fallback");
    const title = node.querySelector(".card-title a");

    thumb.href = item.url;
    title.href = item.url;
    title.textContent = item.title;
    img.alt = "";

    const hue = hashHue(item.host || item.title);
    fb.style.background = `linear-gradient(135deg, hsl(${hue} 60% 55%), hsl(${(hue + 40) % 360} 65% 40%))`;
    fb.querySelector("span").textContent = (item.host || item.title || "?").replace(/^www\./, "")[0].toUpperCase();

    if (item.image && /^https:\/\//.test(item.image)) {
      img.src = item.image;
      img.addEventListener("error", () => thumb.classList.add("no-image"), { once: true });
    } else {
      thumb.classList.add("no-image");
    }

    node.querySelector(".badge-new").hidden = Date.now() - new Date(item.addedAt).getTime() > 86400000;

    const host = node.querySelector(".card-host");
    host.textContent = item.host;
    if (item.region === "jp") {
      const jp = document.createElement("span");
      jp.className = "badge-jp";
      jp.textContent = "JP";
      jp.title = "国内サイト";
      host.prepend(jp);
    }
    node.querySelector(".card-desc").textContent = item.description || "";

    const hl = node.querySelector(".card-headline");
    if (item.headline) {
      hl.hidden = false;
      hl.textContent = item.headline;
      hl.href = item.sources?.[0]?.url || item.url;
      hl.title = `掲載元の見出し: ${item.headline}`;
    }

    const tags = node.querySelector(".card-tags");
    for (const c of item.categories) {
      const b = document.createElement("button");
      b.className = "tag";
      b.textContent = labelOf(c);
      b.title = `「${labelOf(c)}」で絞り込む`;
      b.addEventListener("click", () => setState({ category: c }));
      tags.appendChild(b);
    }
    const platformLabel = (id) => (data.platforms || []).find((p) => p.id === id)?.label || id;
    for (const p of (item.platforms || []).slice(0, 4)) {
      const s = document.createElement("button");
      s.className = "tag sub";
      s.textContent = platformLabel(p);
      s.title = `「${platformLabel(p)}」で絞り込む`;
      s.addEventListener("click", () => setState({ platform: p }));
      tags.appendChild(s);
    }
    for (const t of (item.tags || []).filter((t) => t !== "ゲーム").slice(0, 2)) {
      const s = document.createElement("span");
      s.className = "tag sub";
      s.textContent = t;
      tags.appendChild(s);
    }

    const src = node.querySelector(".source");
    const primary = item.sources?.[0] || { name: item.source, url: item.url };
    src.textContent = item.sources?.length > 1 ? `${primary.name} +${item.sources.length - 1}` : primary.name;
    src.href = primary.url;
    src.title = "掲載元: " + (item.sources?.map((s) => s.name).join(" / ") || primary.name);
    src.style.setProperty("--src-color", SOURCE_COLORS[primary.name] || "#999");

    const pts = node.querySelector(".points");
    if (item.points > 0) {
      pts.hidden = false;
      pts.textContent = `▲ ${item.points}`;
    }

    const time = node.querySelector(".date");
    time.dateTime = item.publishedAt;
    time.textContent = relTime(item.publishedAt);
    time.title = new Date(item.publishedAt).toLocaleString("ja-JP");

    const favBtn = node.querySelector(".fav-btn");
    const syncFav = () => {
      favBtn.classList.toggle("on", isFav(item.id));
      favBtn.setAttribute("aria-label", isFav(item.id) ? "お気に入りから外す" : "お気に入りに追加");
    };
    syncFav();
    favBtn.addEventListener("click", () => {
      toggleFav(item);
      syncFav();
      if (state.favOnly) render();
    });
    return node;
  }

  function renderPagination(total) {
    const nav = $("#pagination");
    nav.innerHTML = "";
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) return;

    const btn = (label, target, opts = {}) => {
      const b = document.createElement("button");
      b.className = "page-btn" + (opts.active ? " active" : "");
      b.textContent = label;
      b.disabled = !!opts.disabled;
      if (opts.label) b.setAttribute("aria-label", opts.label);
      if (opts.active) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => goPage(target));
      return b;
    };
    nav.appendChild(btn("‹", page - 1, { disabled: page === 1, label: "前のページ" }));

    const around = 2;
    let last = 0;
    for (let p = 1; p <= pages; p++) {
      const show = p === 1 || p === pages || Math.abs(p - page) <= around;
      if (!show) continue;
      if (p - last > 1) {
        const e = document.createElement("span");
        e.className = "page-ellipsis";
        e.textContent = "…";
        nav.appendChild(e);
      }
      nav.appendChild(btn(String(p), p, { active: p === page }));
      last = p;
    }
    nav.appendChild(btn("›", page + 1, { disabled: page === pages, label: "次のページ" }));

    const info = document.createElement("div");
    info.className = "page-info";
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, total);
    info.textContent = `${total} 件中 ${from}–${to} 件を表示`;
    nav.appendChild(info);
  }

  function render() {
    renderCategories();
    const items = visibleItems();
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const it of slice) frag.appendChild(makeCard(it));
    grid.appendChild(frag);

    $("#empty").hidden = items.length > 0;
    $("#resultCount").textContent = `${items.length} 件`;
    $("#favTools").hidden = !state.favOnly;
    $("#favToggle").setAttribute("aria-pressed", String(state.favOnly));
    renderPagination(items.length);
  }

  function setState(patch) {
    Object.assign(state, patch);
    page = 1;
    save(STATE_KEY, state);
    render();
  }

  function goPage(p) {
    page = p;
    render();
    const top = $("#toolbar").getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: "smooth" });
  }

  // ---------- data ----------
  async function loadData() {
    const r = await fetch(`data/sites.json?t=${Math.floor(Date.now() / 600000)}`);
    if (!r.ok) throw new Error("no data");
    data = await r.json();
    document.title = `${data.site?.title || "Game Sites Radar"}｜新着ゲーム関連サイトまとめ`;
    renderBrand();
    renderHero();
    renderSources();
    renderFooter();
    render();
  }

  // ---------- events ----------
  $("#searchInput").value = state.query;
  $("#searchInput").addEventListener("input", (e) => setState({ query: e.target.value }));
  $("#periodSelect").value = state.period;
  $("#periodSelect").addEventListener("change", (e) => setState({ period: e.target.value }));
  $("#sourceSelect").addEventListener("change", (e) => setState({ source: e.target.value }));
  $("#regionSelect").value = state.region;
  $("#regionSelect").addEventListener("change", (e) => setState({ region: e.target.value }));
  $("#platformSelect").addEventListener("change", (e) => setState({ platform: e.target.value }));
  $("#sortSelect").value = state.sort;
  $("#sortSelect").addEventListener("change", (e) => setState({ sort: e.target.value }));
  $("#favToggle").addEventListener("click", () => {
    setState({ favOnly: !state.favOnly });
    if (state.favOnly) $("#list").scrollIntoView({ behavior: "smooth" });
  });

  $("#exportFav").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(favorites, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `newsites-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#importFav").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const incoming = JSON.parse(await file.text());
      let n = 0;
      for (const [id, v] of Object.entries(incoming)) {
        if (v && v.url && !favorites[id]) {
          favorites[id] = v;
          n++;
        }
      }
      save(FAV_KEY, favorites);
      $("#favCount").textContent = Object.keys(favorites).length;
      render();
      alert(`${n} 件のお気に入りを追加しました`);
    } catch {
      alert("読み込めませんでした（JSON 形式のファイルを選んでください）");
    }
    e.target.value = "";
  });

  const toTop = $("#toTop");
  const onScroll = () => (toTop.hidden = window.scrollY < 600);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#searchInput")) {
      e.preventDefault();
      $("#searchInput").focus();
    }
  });

  $("#favCount").textContent = Object.keys(favorites).length;
  loadData().catch(() => {
    $("#resultCount").textContent = "データがまだありません。npm run collect を実行してください。";
  });
})();
