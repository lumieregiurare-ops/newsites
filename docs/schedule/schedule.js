(() => {
  const $ = (s) => document.querySelector(s);
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  let sched = { releases: [], prereg: [], platforms: [] };
  let platform = "all";
  let source = "all";
  const SOURCE_GROUPS = [
    { id: "all", label: "すべての情報源" },
    { id: "news", label: "ニュースで発表", test: (r) => !/^(Nintendo|Steam)$/.test(r.source) },
    { id: "nintendo", label: "Nintendo", test: (r) => r.source === "Nintendo" },
    { id: "steam", label: "Steam", test: (r) => r.source === "Steam" },
  ];

  function hashHue(s) {
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function relTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 86400) return `${Math.max(1, Math.floor(diff / 3600))}時間前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}日前`;
    return new Date(iso).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
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

  function renderFilters() {
    const box = $("#platformFilters");
    const used = new Set(sched.releases.flatMap((r) => r.platforms));
    const opts = [{ id: "all", label: "すべて" }, ...(sched.platforms || []).filter((p) => used.has(p.id))];
    box.innerHTML = "";
    for (const o of opts) {
      const b = document.createElement("button");
      b.className = "filter" + (platform === o.id ? " active" : "");
      b.textContent = o.label;
      b.addEventListener("click", () => {
        platform = o.id;
        renderFilters();
        renderReleases();
      });
      box.appendChild(b);
    }
    const sbox = $("#sourceFilters");
    sbox.innerHTML = "";
    for (const g of SOURCE_GROUPS) {
      const b = document.createElement("button");
      b.className = "filter" + (source === g.id ? " active" : "");
      b.textContent = g.label;
      b.addEventListener("click", () => {
        source = g.id;
        renderFilters();
        renderReleases();
      });
      sbox.appendChild(b);
    }
  }

  function renderReleases() {
    const list = $("#scheduleList");
    list.innerHTML = "";
    const labels = new Map((sched.platforms || []).map((p) => [p.id, p.label]));
    const group = SOURCE_GROUPS.find((g) => g.id === source);
    const rows = sched.releases.filter((r) => (platform === "all" || r.platforms.includes(platform)) && (!group?.test || group.test(r)));
    $("#countLine").textContent = `${rows.length} タイトル（向こう ${sched.daysAhead || 120} 日 + 時期のみ発表分）`;
    if (!rows.length) {
      list.innerHTML = `<div class="sched-empty">該当するタイトルがありません。</div>`;
      return;
    }
    const groups = new Map();
    for (const r of rows) {
      const key = r.date ? r.date.slice(0, 7) : "tba:" + r.dateText;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const tpl = $("#scheduleRowTpl");
    for (const [key, items] of groups) {
      const sec = document.createElement("section");
      const h = document.createElement("h3");
      h.className = "sched-month";
      if (/^\d{4}-\d{2}$/.test(key)) h.innerHTML = `${Number(key.slice(5))}月 <small>${key.slice(0, 4)} · ${items.length} 件</small>`;
      else h.innerHTML = `${key.slice(4)} <small>時期のみ発表 · ${items.length} 件</small>`;
      sec.appendChild(h);
      const box = document.createElement("div");
      box.className = "sched-rows";
      for (const r of items) {
        const node = tpl.content.firstElementChild.cloneNode(true);
        node.href = r.url;
        if (r.date) {
          const d = new Date(r.date);
          node.querySelector(".sched-day").textContent = d.getDate();
          node.querySelector(".sched-wd").textContent = WEEKDAYS[d.getDay()];
        } else {
          node.querySelector(".sched-date").classList.add("is-tba");
          node.querySelector(".sched-day").textContent = r.dateText.replace(/^\d{4}年/, "");
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
        node.querySelector(".sched-maker").textContent = r.maker || r.headline || (r.price ? `¥${r.price.toLocaleString()}` : "");
        node.querySelector(".sched-source").textContent = r.source ? `via ${r.source}` : "";
        const plats = node.querySelector(".sched-platforms");
        for (const c of platformChips(r.platforms, labels)) plats.appendChild(c);
        box.appendChild(node);
      }
      sec.appendChild(box);
      list.appendChild(sec);
    }
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

  function renderPrereg() {
    const grid = $("#preregGrid");
    grid.innerHTML = "";
    const labels = new Map((sched.platforms || []).map((p) => [p.id, p.label]));
    if (!sched.prereg.length) {
      grid.innerHTML = `<div class="prereg-empty">現在、事前登録の開始が報じられたタイトルはありません。毎朝 7 時に更新されます。</div>`;
      return;
    }
    const tpl = $("#preregCardTpl");
    for (const p of sched.prereg) {
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
      const started = document.createElement("span");
      started.textContent = `${relTime(p.startedAt)}に判明`;
      meta.appendChild(started);
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
      const store = node.querySelector(".prereg-store");
      if (p.appStore?.url) {
        store.hidden = false;
        store.href = p.appStore.url;
        store.textContent = p.appStore.preorder ? "App Store で予約" : "App Store";
      }
      grid.appendChild(node);
    }
  }

  function renderChanges() {
    const list = $("#changesList");
    list.innerHTML = "";
    const changes = sched.changes || [];
    if (!changes.length) {
      list.innerHTML = `<li class="changes-empty">記録された変化はまだありません。発売日の決定や延期があると、ここに履歴が並びます。</li>`;
      return;
    }
    for (const c of changes) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = c.url || "#";
      if (c.url) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      const badge = document.createElement("span");
      badge.className = `change-badge change-${c.type}`;
      badge.textContent = c.label;
      const text = document.createElement("span");
      text.className = "change-text";
      text.textContent = c.title;
      if (c.from && c.to) {
        const sub = document.createElement("span");
        sub.className = "change-from";
        sub.textContent = ` ${c.from} → ${c.to}`;
        text.appendChild(sub);
      } else if (c.to) {
        const sub = document.createElement("span");
        sub.className = "change-from";
        sub.textContent = ` ${c.to}`;
        text.appendChild(sub);
      }
      const when = document.createElement("span");
      when.className = "change-when";
      when.textContent = relTime(c.at);
      a.append(badge, text, when);
      li.appendChild(a);
      list.appendChild(li);
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
      const r = await fetch(`../data/schedule.json?t=${Math.floor(Date.now() / 600000)}`);
      sched = await r.json();
      const u = new Date(sched.updatedAt);
      $("#scheduleUpdated").textContent = ` 最終更新 ${u.getMonth() + 1}/${u.getDate()} ${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}`;
      renderFilters();
      renderReleases();
      renderPrereg();
      renderChanges();
    } catch {
      $("#scheduleList").innerHTML = `<div class="sched-empty">スケジュールを読み込めませんでした。</div>`;
    }
  }
  boot();
})();
