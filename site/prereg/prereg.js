(() => {
  const $ = (s) => document.querySelector(s);
  let sched = { prereg: [], platforms: [] };
  let filter = "all";
  const FILTERS = [
    { id: "all", label: "すべて" },
    { id: "dated", label: "配信日決定", test: (p) => !!p.releaseText },
    { id: "tba", label: "配信日未定", test: (p) => !p.releaseText },
    { id: "store", label: "App Store で予約可", test: (p) => !!p.appStore?.preorder },
    { id: "unverified", label: "未確認", test: (p) => p.verified === false },
  ];

  function hashHue(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function xIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2H21.5l-7.5 8.57L22.8 22h-6.9l-5.4-7.06L4.3 22H1.04l8.02-9.17L.6 2h7.07l4.88 6.45L18.24 2Zm-1.2 18h1.8L7.02 3.9H5.1L17.04 20Z"/></svg>`;
  }
  function socialLinks(site) {
    const links = [];
    if (site.x) links.push(`<a class="social social-x" href="${site.x}" target="_blank" rel="noopener noreferrer" aria-label="X">${xIcon()}<span>X</span></a>`);
    if (site.note) links.push(`<a class="social social-note" href="${site.note}" target="_blank" rel="noopener noreferrer" aria-label="note"><span class="note-mark">n</span><span>note</span></a>`);
    return links.join("");
  }
  function platformChips(ids, labels) {
    return (ids || []).map((id) => {
      const s = document.createElement("span");
      s.className = `plat plat-${id}`;
      s.textContent = labels.get(id) || id;
      return s;
    });
  }
  // 配信日は出どころによって信頼度が違うので、どこの情報かを添える
  function releaseChip(p) {
    const s = document.createElement("span");
    if (!p.releaseText) {
      s.className = "rel-unknown";
      s.textContent = "配信日未定";
      s.title = "配信日がまだ発表されていないか、確認できていません";
      return s;
    }
    if (p.releaseSource === "appstore") {
      s.className = "rel-store";
      s.textContent = `App Store ${p.releaseText}`;
      s.title = p.announcedText
        ? `App Store の予約ページに表示されている配信予定日です（発表時は ${p.announcedText}）`
        : "App Store の予約ページに表示されている配信予定日です";
      return s;
    }
    s.className = "rel-news";
    s.textContent = p.releaseText;
    s.title = "掲載元の記事見出しに書かれていた日付です";
    return s;
  }

  // 配信日が近いものを先に。未定は最後にまとめ、その中では新しく見つけた順
  function sortKey(p) {
    const m = (p.releaseText || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) return `0-${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const m2 = (p.releaseText || "").match(/(\d{4})年(\d{1,2})月/);
    if (m2) return `1-${m2[1]}-${m2[2].padStart(2, "0")}`;
    if (p.releaseText) return `2-${p.releaseText}`;
    // 未確認は最後尾
    return `${p.verified === false ? 4 : 3}-${99999999999999 - new Date(p.startedAt).getTime()}`;
  }

  function renderFilters() {
    const box = $("#dateFilters");
    box.innerHTML = "";
    for (const f of FILTERS) {
      const n = f.test ? sched.prereg.filter(f.test).length : sched.prereg.length;
      const b = document.createElement("button");
      b.className = "filter" + (filter === f.id ? " active" : "");
      b.textContent = `${f.label} ${n}`;
      b.addEventListener("click", () => {
        filter = f.id;
        renderFilters();
        render();
      });
      box.appendChild(b);
    }
  }

  function render() {
    const grid = $("#preregGrid");
    grid.innerHTML = "";
    const labels = new Map((sched.platforms || []).map((p) => [p.id, p.label]));
    const f = FILTERS.find((x) => x.id === filter);
    const list = sched.prereg.filter((p) => !f?.test || f.test(p)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    $("#countLine").textContent = `${list.length} タイトル`;
    if (!list.length) {
      grid.innerHTML = `<div class="prereg-empty">該当するタイトルはありません。</div>`;
      return;
    }
    const tpl = $("#preregCardTpl");
    for (const p of list) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const thumb = node.querySelector(".prereg-thumb");
      const img = thumb.querySelector("img");
      thumb.href = p.url;
      const hue = hashHue(p.title);
      node.querySelector(".prereg-thumb-fallback").style.background = `linear-gradient(135deg, hsl(${hue} 70% 50%), hsl(${(hue + 50) % 360} 70% 35%))`;
      node.querySelector(".prereg-thumb-fallback span").textContent = p.title[0];
      if (p.image && /^https:\/\//.test(p.image)) {
        img.src = p.image;
        img.addEventListener("error", () => thumb.classList.add("no-image"), { once: true });
      } else {
        thumb.classList.add("no-image");
      }
      const t = node.querySelector(".prereg-title a");
      t.href = p.url;
      t.textContent = p.title;
      const meta = node.querySelector(".prereg-meta");
      for (const c of platformChips(p.platforms, labels)) meta.appendChild(c);
      meta.appendChild(releaseChip(p));
      if (p.count) {
        const s = document.createElement("span");
        s.className = "prereg-count";
        s.textContent = p.count;
        meta.appendChild(s);
      }
      const reward = node.querySelector(".prereg-reward");
      if (p.reward) {
        reward.hidden = false;
        reward.textContent = `特典: ${p.reward}`;
      }
      const hl = node.querySelector(".prereg-headline");
      hl.textContent = p.headline || "";
      hl.href = p.sourceUrl || p.url;
      hl.hidden = !p.headline;
      node.querySelector(".prereg-link").href = p.url;
      if (p.verified === false) {
        const badge = node.querySelector(".prereg-badge");
        badge.classList.add("is-unverified");
        badge.textContent = "事前登録中・未確認";
        badge.title = `${p.source} の事前登録一覧に掲載されていますが、App Store では確認できていません（Android 専用などの可能性）`;
        if (!p.officialKnown) node.querySelector(".prereg-link").textContent = `${p.source} で見る →`;
      }
      const store = node.querySelector(".prereg-store");
      if (p.appStore?.url) {
        store.hidden = false;
        store.href = p.appStore.url;
        store.textContent = p.appStore.preorder ? "App Store で予約" : "App Store";
      }
      grid.appendChild(node);
    }
  }

  async function boot() {
    $("#year").textContent = new Date().getFullYear();
    try {
      const site = await (await fetch("../data/site.json")).json();
      $("#headerSocial").innerHTML = socialLinks(site);
      $("#footerSocial").innerHTML = socialLinks(site);
    } catch {
      /* optional */
    }
    try {
      const r = await fetch(`../data/prereg.json?t=${Math.floor(Date.now() / 600000)}`);
      sched = await r.json();
      renderFilters();
      render();
    } catch {
      $("#preregGrid").innerHTML = `<div class="prereg-empty">データを読み込めませんでした。</div>`;
    }
  }
  boot();
})();
