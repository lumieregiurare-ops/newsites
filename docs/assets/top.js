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

  // ---------- schedule / prereg ----------
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const SCHEDULE_ROWS = 14;
  const PREREG_MAX = 8;

  function platformChips(ids, labels) {
    return (ids || []).map((id) => {
      const s = document.createElement("span");
      s.className = `plat plat-${id}`;
      s.textContent = labels.get(id) || id;
      return s;
    });
  }

  function renderSchedule(sched) {
    const list = $("#scheduleList");
    list.innerHTML = "";
    const labels = new Map((sched.platforms || []).map((p) => [p.id, p.label]));
    // トップでは「注目」を優先して選び（ニュースで報じられた作品 → 任天堂の予約受付中 → Steam 人気順）、日付順に並べ直す
    const rows = (sched.releases || [])
      .filter((r) => r.date)
      .slice()
      .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.sortKey.localeCompare(b.sortKey))
      .slice(0, SCHEDULE_ROWS)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (!rows.length) {
      list.innerHTML = `<div class="sched-empty">発売予定のデータがまだありません。</div>`;
      return;
    }
    const groups = new Map();
    for (const r of rows) {
      const key = r.date ? r.date.slice(0, 7) : r.dateText;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const tpl = $("#scheduleRowTpl");
    for (const [key, items] of groups) {
      const sec = document.createElement("section");
      const h = document.createElement("h3");
      h.className = "sched-month";
      if (/^\d{4}-\d{2}$/.test(key)) {
        h.innerHTML = `${Number(key.slice(5))}月 <small>${key.slice(0, 4)}</small>`;
      } else {
        h.innerHTML = `${key} <small>時期のみ発表</small>`;
      }
      sec.appendChild(h);
      const box = document.createElement("div");
      box.className = "sched-rows";
      for (const r of items) {
        const node = tpl.content.firstElementChild.cloneNode(true);
        node.href = r.url;
        const dateEl = node.querySelector(".sched-date");
        if (r.date) {
          const d = new Date(r.date);
          node.querySelector(".sched-day").textContent = d.getDate();
          node.querySelector(".sched-wd").textContent = WEEKDAYS[d.getDay()];
        } else {
          dateEl.classList.add("is-tba");
          node.querySelector(".sched-day").textContent = r.dateText.replace(/^\d{4}年/, "");
          node.querySelector(".sched-wd").textContent = "";
        }
        const thumb = node.querySelector(".sched-thumb");
        const img = thumb.querySelector("img");
        if (r.image && /^https:\/\//.test(r.image)) {
          img.src = r.image;
          img.addEventListener("error", () => thumb.classList.add("no-image"), { once: true });
        } else {
          thumb.classList.add("no-image");
        }
        node.querySelector(".sched-title").textContent = r.title;
        node.querySelector(".sched-maker").textContent = r.maker || r.headline || "";
        node.querySelector(".sched-source").textContent = r.source ? `via ${r.source}` : "";
        const plats = node.querySelector(".sched-platforms");
        for (const c of platformChips(r.platforms, labels)) plats.appendChild(c);
        box.appendChild(node);
      }
      sec.appendChild(box);
      list.appendChild(sec);
    }
  }

  function renderPrereg(sched) {
    const grid = $("#preregGrid");
    grid.innerHTML = "";
    const labels = new Map((sched.platforms || []).map((p) => [p.id, p.label]));
    const items = (sched.prereg || []).slice(0, PREREG_MAX);
    if (!items.length) {
      grid.innerHTML = `<div class="prereg-empty">現在、事前登録の開始が報じられたタイトルはありません。毎朝 7 時に更新されます。</div>`;
      return;
    }
    const tpl = $("#preregCardTpl");
    for (const p of items) {
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
      if (p.releaseText) {
        const s = document.createElement("span");
        s.textContent = p.releaseText;
        meta.appendChild(s);
      }
      const started = document.createElement("span");
      started.textContent = `${relTime(p.startedAt)}に開始`;
      meta.appendChild(started);
      const hl = node.querySelector(".prereg-headline");
      hl.textContent = p.headline || "";
      hl.href = p.sourceUrl || p.url;
      hl.hidden = !p.headline;
      node.querySelector(".prereg-link").href = p.url;
      grid.appendChild(node);
    }
  }

  async function loadSchedule() {
    try {
      const r = await fetch(`data/schedule.json?t=${Math.floor(Date.now() / 600000)}`);
      if (!r.ok) throw new Error("no schedule");
      const sched = await r.json();
      renderSchedule(sched);
      renderPrereg(sched);
      const u = new Date(sched.updatedAt);
      $("#scheduleUpdated").textContent = `最終更新 ${u.getMonth() + 1}/${u.getDate()}`;
    } catch {
      $("#scheduleList").innerHTML = `<div class="sched-empty">スケジュールを読み込めませんでした。</div>`;
      $("#preregGrid").innerHTML = "";
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

  loadSchedule();
})();
