// ニュース一覧ページ。絞り込みの状態は URL に持たせる（共有・戻る操作でそのまま再現できるように）
(() => {
  const { $, esc } = GL;
  const FAV_KEY = "newsites:favorites";
  const PAGE_SIZE = 30;
  const DEFAULTS = { q: "", platform: "all", category: "all", region: "all", source: "all", period: "all", fav: "", page: "1" };

  let data = { items: [], categories: [], sources: [], platforms: [] };
  let all = [];
  let favorites = loadFavs();
  const state = readUrl();

  function loadFavs() {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveFavs() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
    } catch {
      /* 保存できない環境では、このページを開いている間だけ有効 */
    }
    $("#favCount").textContent = Object.keys(favorites).length;
  }

  function readUrl() {
    const q = new URLSearchParams(location.search);
    const s = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (q.has(k)) s[k] = q.get(k);
    if (!q.has("q") && q.has("query")) s.q = q.get("query");
    return s;
  }
  function writeUrl() {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v && v !== DEFAULTS[k]) q.set(k, v);
    const qs = q.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  const platformName = (id) => GL.PLATFORM_NAME[id] || data.platforms.find((p) => p.id === id)?.label || id;
  const categoryName = (id) => GL.CATEGORY[id] || data.categories.find((c) => c.id === id)?.label || id;

  // ---------- 絞り込み ----------
  function baseItems() {
    if (!state.fav) return all;
    const ids = new Set(all.map((n) => n.id));
    const extra = Object.values(favorites)
      .filter((f) => f && f.id && !ids.has(f.id) && f.url)
      .map(GL.norm);
    return [...all.filter((n) => favorites[n.id]), ...extra].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  }

  function matches(n, { skip = "" } = {}) {
    if (skip !== "platform" && state.platform !== "all") {
      const want = state.platform === "switch" ? ["switch", "switch2"] : [state.platform];
      if (!want.some((p) => n.platforms.includes(p))) return false;
    }
    if (skip !== "category" && state.category !== "all" && !n.categories.includes(state.category)) return false;
    if (state.region !== "all" && (n.region || "global") !== state.region) return false;
    if (skip !== "source" && state.source !== "all" && !n.sourceNames.includes(state.source)) return false;
    if (!state.fav && state.period !== "all") {
      if (new Date(n.publishedAt).getTime() < Date.now() - Number(state.period) * 86400000) return false;
    }
    if (state.q) {
      const hay = `${n.title} ${n.name} ${n.lead} ${n.host} ${n.tags.join(" ")} ${n.categories.map(categoryName).join(" ")} ${n.sourceNames.join(" ")}`.toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  // ---------- 描画 ----------
  function renderHeading() {
    let title = "ニュース";
    if (state.fav) title = "お気に入り";
    else if (state.q) title = `「${state.q}」のニュース`;
    else if (state.platform !== "all") title = `${platformName(state.platform)}のニュース`;
    else if (state.category !== "all") title = `${categoryName(state.category)}のニュース`;
    $("#pageTitle").textContent = title;
    $("#crumbTail").textContent = title;
    document.title = `${title}｜GameLab Radar`;
  }

  function renderTabs() {
    const box = $("#platformTabs");
    const base = baseItems().filter((n) => matches(n, { skip: "platform" }));
    const count = (id) => base.filter((n) => (id === "switch" ? n.platforms.includes("switch") || n.platforms.includes("switch2") : n.platforms.includes(id))).length;
    const tabs = [{ id: "all", label: "すべて", n: base.length }];
    for (const p of data.platforms || []) {
      if (p.id === "switch2") continue; // Switch タブに含める
      const n = count(p.id);
      if (n || state.platform === p.id) tabs.push({ id: p.id, label: p.id === "switch" ? "Switch" : p.id === "pc" ? "PC" : p.label, n });
    }
    box.innerHTML = tabs
      .map((t) => `<button class="tab" type="button" role="tab" data-p="${esc(t.id)}" aria-selected="${state.platform === t.id}">${esc(t.label)}<small>${t.n}</small></button>`)
      .join("");
    box.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setState({ platform: b.dataset.p })));
  }

  function renderSelects() {
    const cats = (data.categories || []).filter((c) => c.count > 0);
    $("#categorySelect").innerHTML =
      `<option value="all">すべて</option>` + cats.map((c) => `<option value="${esc(c.id)}">${esc(categoryName(c.id))}</option>`).join("");
    $("#sourceSelect").innerHTML =
      `<option value="all">すべて</option>` + (data.sources || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    syncControls();
  }

  function syncControls() {
    $("#searchInput").value = state.q;
    $("#categorySelect").value = state.category;
    $("#periodSelect").value = state.period;
    $("#regionSelect").value = state.region;
    $("#sourceSelect").value = state.source;
    $("#favToggle").setAttribute("aria-pressed", String(!!state.fav));
    $("#favTools").hidden = !state.fav;
    const head = $(".search input");
    if (head) head.value = state.q;
  }

  function renderSide() {
    const counted = { ...data, categories: (data.categories || []).map((c) => ({ ...c, count: all.filter((n) => n.categories.includes(c.id)).length })) };
    GL.renderCategoryBox($("#sideCats"), counted, { active: state.category, onPick: (id) => setState({ category: state.category === id ? "all" : id }) });

    const counts = new Map();
    for (const n of all) for (const s of new Set(n.sourceNames)) counts.set(s, (counts.get(s) || 0) + 1);
    const rows = [...counts].sort((a, b) => b[1] - a[1]);
    $("#sideSources").innerHTML = `<h2 class="side-title">掲載元</h2><ul class="cat-list">${rows
      .map(
        ([s, n]) => `<li><a href="?source=${encodeURIComponent(s)}" data-src="${esc(s)}"${state.source === s ? ' class="active"' : ""}><span>${esc(s)}</span><span class="n">${n}</span></a></li>`
      )
      .join("")}</ul>`;
    $("#sideSources")
      .querySelectorAll("a[data-src]")
      .forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          setState({ source: state.source === a.dataset.src ? "all" : a.dataset.src });
        })
      );
  }

  function renderPager(total, page) {
    const nav = $("#pager");
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) {
      nav.innerHTML = "";
      return;
    }
    const btn = (label, p, { active = false, disabled = false, aria = "" } = {}) =>
      `<button type="button" data-page="${p}"${active ? ' class="active" aria-current="page"' : ""}${disabled ? " disabled" : ""}${aria ? ` aria-label="${aria}"` : ""}>${label}</button>`;
    let html = btn("‹", page - 1, { disabled: page === 1, aria: "前のページ" });
    let last = 0;
    for (let p = 1; p <= pages; p++) {
      if (!(p === 1 || p === pages || Math.abs(p - page) <= 2)) continue;
      if (p - last > 1) html += `<span class="gap">…</span>`;
      html += btn(String(p), p, { active: p === page });
      last = p;
    }
    html += btn("›", page + 1, { disabled: page === pages, aria: "次のページ" });
    nav.innerHTML = html;
    nav.querySelectorAll("button[data-page]").forEach((b) =>
      b.addEventListener("click", () => {
        state.page = b.dataset.page;
        writeUrl();
        renderList();
        const top = $("#pageTitle").getBoundingClientRect().top + window.scrollY - 60;
        window.scrollTo({ top, behavior: "smooth" });
      })
    );
  }

  function renderList() {
    const items = baseItems().filter((n) => matches(n));
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number(state.page) || 1), pages);
    const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const list = $("#list");
    if (!slice.length) {
      list.innerHTML = state.fav
        ? `<p class="list-empty">お気に入りはまだありません。記事の ★ を押すと追加できます。</p>`
        : `<p class="list-empty">条件に合うニュースはありません。</p>`;
    } else {
      list.innerHTML = GL.newsList(slice, (n) => ({ fav: true, faved: !!favorites[n.id] }));
    }
    const from = items.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    $("#resultCount").innerHTML = `<strong>${items.length}</strong> 件${items.length > PAGE_SIZE ? `（${from}〜${Math.min(page * PAGE_SIZE, items.length)} 件目）` : ""}`;
    renderPager(items.length, page);
  }

  function render() {
    renderHeading();
    renderTabs();
    syncControls();
    renderList();
    renderSide();
  }

  function setState(patch) {
    Object.assign(state, patch, { page: "1" });
    writeUrl();
    render();
  }

  // ---------- 操作 ----------
  let typing;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => setState({ q: e.target.value.trim() }), 200);
  });
  $("#categorySelect").addEventListener("change", (e) => setState({ category: e.target.value }));
  $("#periodSelect").addEventListener("change", (e) => setState({ period: e.target.value }));
  $("#regionSelect").addEventListener("change", (e) => setState({ region: e.target.value }));
  $("#sourceSelect").addEventListener("change", (e) => setState({ source: e.target.value }));
  // お気に入りを開くときは、ほかの絞り込みを外して全件を見せる
  $("#favToggle").addEventListener("click", () =>
    setState(state.fav ? { fav: "" } : { ...DEFAULTS, fav: "1" })
  );

  // ヘッダーの検索欄はこのページ内では再読み込みせずに絞り込む
  const headSearch = $(".search");
  if (headSearch) {
    headSearch.addEventListener("submit", (e) => {
      e.preventDefault();
      setState({ q: headSearch.querySelector("input").value.trim(), platform: "all", category: "all", source: "all", fav: "" });
    });
  }

  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-fav]");
    if (!b) return;
    const id = b.dataset.fav;
    if (favorites[id]) delete favorites[id];
    else {
      const raw = all.find((n) => n.id === id)?.raw;
      if (raw) favorites[id] = { ...raw, savedAt: new Date().toISOString() };
    }
    saveFavs();
    const on = !!favorites[id];
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    if (state.fav) render();
  });

  $("#exportFav").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(favorites, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gamelab-favorites-${new Date().toISOString().slice(0, 10)}.json`;
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
      saveFavs();
      render();
      alert(`${n} 件のお気に入りを追加しました`);
    } catch {
      alert("読み込めませんでした（書き出した JSON ファイルを選んでください）");
    }
    e.target.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      $("#searchInput").focus();
    }
  });

  // ---------- 読み込み ----------
  $("#favCount").textContent = Object.keys(favorites).length;
  GL.getJson("radar/data/sites.json")
    .then((d) => {
      data = d;
      all = d.items.map(GL.norm).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      renderSelects();
      render();
    })
    .catch(() => {
      $("#list").innerHTML = `<p class="list-empty">ニュースを読み込めませんでした。時間をおいて再度お試しください。</p>`;
    });
  GL.renderRanking($("#ranking"));
})();
