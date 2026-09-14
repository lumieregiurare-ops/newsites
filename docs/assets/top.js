(() => {
  const $ = (s) => document.querySelector(s);
  const RADAR_LIMIT = 8;

  const ICON_X =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.4l8.1-9.3L.7 2h7.2l5 6.6L18.9 2zm-1.2 18h1.9L7.4 3.9H5.3L17.7 20z"/></svg>';

  function hashHue(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function gradientFor(seed) {
    const hue = hashHue(seed);
    return `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 60) % 360} 70% 35%))`;
  }
  function relTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}日前`;
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  async function getJson(path) {
    const r = await fetch(`${path}?t=${Math.floor(Date.now() / 600000)}`);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  // ---------- SNS links ----------
  function renderSocial(site) {
    const links = [];
    if (site.x) links.push(`<a class="social social-x" href="${site.x}" target="_blank" rel="noopener noreferrer">${ICON_X}<span>X</span></a>`);
    if (site.note) links.push(`<a class="social social-note" href="${site.note}" target="_blank" rel="noopener noreferrer"><span class="note-mark">n</span><span>note</span></a>`);
    $("#headerSocial").innerHTML = links.join("");
    $("#footerSocial").innerHTML = links.join("");
  }

  // ---------- Games ----------
  function renderGames(games) {
    const grid = $("#gamesGrid");
    grid.innerHTML = "";
    const live = games.filter((g) => g.status === "live").length;
    $("#statGames").textContent = live || games.length;
    if (!games.length) {
      grid.innerHTML = `<div class="games-empty">最初のゲームを準備中です。</div>`;
      return;
    }
    const tpl = $("#gameCardTpl");
    for (const g of games) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const cover = node.querySelector(".game-cover");
      const img = cover.querySelector("img");
      const fb = cover.querySelector(".game-cover-fallback");
      const href = g.url || "#games";

      cover.href = href;
      fb.style.background = gradientFor(g.title);
      fb.querySelector("span").textContent = g.emoji || g.title[0];
      if (g.image) {
        img.src = g.image;
        img.alt = g.title;
        img.addEventListener("error", () => cover.classList.add("no-image"), { once: true });
      } else {
        cover.classList.add("no-image");
      }

      const status = node.querySelector(".game-status");
      const isLive = g.status === "live";
      status.textContent = isLive ? "公開中" : g.status === "soon" ? "近日公開" : "開発中";
      status.classList.add(isLive ? "is-live" : "is-wip");

      const t = node.querySelector(".game-title a");
      t.textContent = g.title;
      t.href = href;
      node.querySelector(".game-desc").textContent = g.description || "";
      node.querySelector(".game-tags").innerHTML = (g.tags || []).map((x) => `<span>${x}</span>`).join("");

      const link = node.querySelector(".game-link");
      if (g.url) {
        link.href = g.url;
        link.innerHTML = `${g.linkLabel || (isLive ? "プレイする" : "詳しく見る")} <span aria-hidden="true">→</span>`;
      } else {
        link.remove();
      }
      grid.appendChild(node);
    }
  }

  // ---------- Radar ----------
  function renderRadar(data) {
    const grid = $("#radarGrid");
    const labelOf = (id) => data.categories?.find((c) => c.id === id)?.label || "";
    const items = [...data.items].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, RADAR_LIMIT);

    $("#statSites").textContent = data.total ?? data.items.length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    $("#statToday").textContent = data.items.filter((i) => new Date(i.addedAt) >= today).length;
    const u = new Date(data.updatedAt);
    $("#radarUpdated").textContent = `最終更新 ${u.getMonth() + 1}/${u.getDate()} ${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}`;

    const tpl = $("#radarCardTpl");
    grid.innerHTML = "";
    for (const it of items) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.href = it.url;
      node.title = it.title;
      const thumb = node.querySelector(".radar-thumb");
      const img = thumb.querySelector("img");
      const fb = thumb.querySelector(".radar-thumb-fallback");
      fb.style.background = gradientFor(it.host || it.title);
      fb.querySelector("span").textContent = (it.host || it.title || "?").replace(/^www\./, "")[0].toUpperCase();
      if (it.image && /^https:\/\//.test(it.image)) {
        img.src = it.image;
        img.addEventListener("error", () => thumb.classList.add("no-image"), { once: true });
      } else {
        thumb.classList.add("no-image");
      }
      node.querySelector(".radar-cat").textContent = labelOf(it.categories?.[0]);
      node.querySelector(".radar-title").textContent = it.title;
      node.querySelector(".radar-host").textContent = (it.region === "jp" ? "JP · " : "") + it.host;
      const time = node.querySelector(".radar-date");
      time.dateTime = it.publishedAt;
      time.textContent = relTime(it.publishedAt);
      grid.appendChild(node);
    }
  }

  // ---------- boot ----------
  $("#year").textContent = new Date().getFullYear();

  getJson("data/site.json")
    .then(renderSocial)
    .catch(() => renderSocial({}));

  getJson("data/games.json")
    .then((d) => renderGames(d.games || []))
    .catch(() => renderGames([]));

  getJson("radar/data/sites.json")
    .then(renderRadar)
    .catch(() => {
      $("#radarGrid").innerHTML = `<div class="games-empty">Radar のデータを読み込めませんでした。</div>`;
    });
})();
