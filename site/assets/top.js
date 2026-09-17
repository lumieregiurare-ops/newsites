(() => {
  const $ = (s) => document.querySelector(s);
  const RADAR_LIMIT = 8;
  const RADAR_NEWEST = 5; // 先頭は必ず新着順。残りは直近数日からランダムに入れ替えて、来るたび顔ぶれが変わるようにする
  const ROTATE_DAYS = 7;
  const VISIT_KEY = "gamelab:visit";
  const VISIT_GAP_MS = 30 * 60 * 1000; // これ以上あいたら「別の訪問」とみなす

  // 前回この端末で見たときの時刻。localStorage にだけ置き、サーバーには送らない。
  // 連続リロードで基準が動くと NEW が消えてしまうので、30 分以上あいたときだけ繰り上げる。
  const lastVisit = (() => {
    const now = Date.now();
    try {
      const raw = JSON.parse(localStorage.getItem(VISIT_KEY) || "null");
      const touched = raw && typeof raw.touched === "number" ? raw.touched : null;
      const base = touched == null ? null : now - touched > VISIT_GAP_MS ? touched : raw.base ?? touched;
      localStorage.setItem(VISIT_KEY, JSON.stringify({ base, touched: now }));
      return base;
    } catch {
      return null; // プライベートモードなどで保存できない場合は何も出さない
    }
  })();
  const isNewSince = (it) => lastVisit != null && new Date(it.addedAt).getTime() > lastVisit;

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

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

  // ---------- Radar ----------
  // 先頭 5 件は新着順、残り 3 件は直近 7 日からランダムに選ぶ。
  // 全件を新着順で切ると収集が走るまで顔ぶれが変わらず、埋もれたサイトも表に出てこないため。
  function pickRadarItems(all) {
    const sorted = [...all].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const head = sorted.slice(0, RADAR_NEWEST);
    const want = RADAR_LIMIT - head.length;
    const rest = sorted.slice(RADAR_NEWEST);
    const cutoff = Date.now() - ROTATE_DAYS * 86400000;
    const picked = shuffle(rest.filter((it) => new Date(it.publishedAt).getTime() >= cutoff)).slice(0, want);
    // 直近 7 日の在庫が足りないときは新しい順で埋める
    for (const it of rest) {
      if (picked.length >= want) break;
      if (!picked.includes(it)) picked.push(it);
    }
    picked.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return [...head, ...picked];
  }

  // 前回この端末で見たとき以降に載った件数を Radar セクションの先頭に出す
  function renderVisitDiff(data) {
    if (lastVisit == null) return;
    const count = data.items.filter((it) => new Date(it.addedAt).getTime() > lastVisit).length;
    if (!count) return;
    const grid = $("#radarGrid");
    const bar = document.createElement("p");
    bar.className = "visit-diff";
    bar.innerHTML = `新着 <strong>${count}</strong> 件`;
    grid.parentNode.insertBefore(bar, grid);
  }

  function renderRadar(data) {
    const grid = $("#radarGrid");
    const labelOf = (id) => data.categories?.find((c) => c.id === id)?.label || "";
    const items = pickRadarItems(data.items);

    // 掲載数の表示はページに無いこともある（ヒーローを置かない構成）
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const stats = { statSites: data.total ?? data.items.length, statToday: data.items.filter((i) => new Date(i.addedAt) >= today).length };
    for (const [id, v] of Object.entries(stats)) {
      const el = $(`#${id}`);
      if (el) el.textContent = v;
    }
    grid.innerHTML = "";
    for (const it of items) grid.appendChild(makeRadarCard(it, labelOf));
  }

  function makeRadarCard(it, labelOf) {
    const tpl = $("#radarCardTpl");
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
    if (isNewSince(it)) {
      const badge = document.createElement("span");
      badge.className = "radar-new";
      badge.textContent = "NEW";
      thumb.appendChild(badge);
    }
    node.querySelector(".radar-title").textContent = it.title;
    node.querySelector(".radar-host").textContent = (it.region === "jp" ? "JP · " : "") + it.host;
    const time = node.querySelector(".radar-date");
    time.dateTime = it.publishedAt;
    time.textContent = relTime(it.publishedAt);
    return node;
  }

  // スマホゲーム: 機種判定が「スマホ」の項目と App Store 新着
  function renderMobile(data) {
    const grid = $("#mobileGrid");
    const labelOf = (id) => data.categories?.find((c) => c.id === id)?.label || "";
    const items = data.items
      .filter((it) => (it.platforms || []).includes("mobile") || it.source === "App Store")
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, RADAR_LIMIT);
    grid.innerHTML = "";
    if (!items.length) {
      grid.innerHTML = `<div class="games-empty">スマホゲームのデータがまだありません。</div>`;
      return;
    }
    for (const it of items) grid.appendChild(makeRadarCard(it, labelOf));
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
        if (r.dateSource === "appstore") node.title = `App Store の配信予定日です${r.announcedText ? `（発表時は ${r.announcedText}）` : ""}`;
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
    // トップでは裏取りできているものを優先して出す
    const items = [...(sched.prereg || [])].sort((a, b) => (a.verified === false ? 1 : 0) - (b.verified === false ? 1 : 0)).slice(0, PREREG_MAX);
    if (!items.length) {
      grid.innerHTML = `<div class="prereg-empty">現在、事前登録の開始が報じられたタイトルはありません。</div>`;
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
      fillPreregMeta(node, p, labels);
      grid.appendChild(node);
    }
  }

  function fillPreregMeta(node, p, labels) {
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

  function renderChanges(sched) {
    const box = $("#changesBox");
    const list = $("#changesList");
    const changes = (sched.changes || []).slice(0, 6);
    if (!changes.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    list.innerHTML = "";
    for (const c of changes) list.appendChild(changeRow(c));
  }

  function changeRow(c) {
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
    return li;
  }

  async function loadSchedule() {
    try {
      // トップ用の抜粋だけを読む（全件版は 450KB 超あり表示が遅くなる）
      const r = await fetch(`data/schedule-top.json?t=${Math.floor(Date.now() / 600000)}`);
      if (!r.ok) throw new Error("no schedule");
      const sched = await r.json();
      renderSchedule(sched);
      renderPrereg(sched);
      renderChanges(sched);
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

  getJson("radar/data/sites.json")
    .then((d) => {
      renderRadar(d);
      renderMobile(d);
      renderVisitDiff(d);
    })
    .catch(() => {
      $("#radarGrid").innerHTML = `<div class="games-empty">Radar のデータを読み込めませんでした。</div>`;
    });

  loadSchedule();

  // Steam / App Store の人気ランキング（順位の動き付き）
  getJson("data/rankings.json")
    .then((data) => {
      const boards = data?.boards || [];
      if (!boards.length) return;
      $("#ranking").hidden = false;

      const tabs = $("#rankTabs");
      const list = $("#rankList");
      const note = $("#rankNote");
      let current = 0;

      function draw() {
        const b = boards[current];
        [...tabs.children].forEach((el, i) => {
          el.classList.toggle("active", i === current);
          el.setAttribute("aria-selected", String(i === current));
        });
        note.innerHTML = `${b.note}。出典: <a href="${b.sourceUrl}" target="_blank" rel="noopener noreferrer">${b.label}</a>`;
        list.classList.toggle("is-square", !!b.square);
        list.innerHTML = "";
        for (const it of b.items) {
          const li = document.createElement("li");
          li.className = "rank-item";
          const n = document.createElement("span");
          n.className = "rank-no";
          n.textContent = it.rank;
          const thumb = document.createElement("a");
          thumb.className = "rank-thumb";
          thumb.href = it.url;
          thumb.target = "_blank";
          thumb.rel = "noopener noreferrer";
          if (it.image) {
            const img = document.createElement("img");
            img.src = it.image;
            img.alt = "";
            img.referrerPolicy = "no-referrer";
            img.addEventListener("error", () => thumb.classList.add("no-image"), { once: true });
            thumb.appendChild(img);
          } else {
            thumb.classList.add("no-image");
          }
          const body = document.createElement("div");
          body.className = "rank-body";
          const t = document.createElement("a");
          t.className = "rank-title";
          t.href = it.url;
          t.target = "_blank";
          t.rel = "noopener noreferrer";
          t.textContent = it.title;
          const meta = document.createElement("div");
          meta.className = "rank-meta";
          meta.textContent = it.metric || "";
          body.append(t, meta);
          const d = document.createElement("span");
          d.className = `rank-delta is-${it.delta.kind}`;
          d.textContent = it.delta.label;
          d.hidden = it.delta.kind === "none";
          d.title = it.delta.kind === "new" ? `${it.deltaNote}で圏外から浮上` : `${it.deltaNote}の順位変動`;
          li.append(n, thumb, body, d);
          list.appendChild(li);
        }
      }

      boards.forEach((b, i) => {
        const btn = document.createElement("button");
        btn.className = "rank-tab";
        btn.setAttribute("role", "tab");
        btn.innerHTML = `${b.label}<small>${b.title}</small>`;
        btn.addEventListener("click", () => {
          current = i;
          draw();
        });
        tabs.appendChild(btn);
      });
      draw();
    })
    .catch(() => {});

  // note の記事一覧（自分の記事。RSS から取ったタイトル・サムネイル・冒頭だけを表示）
  getJson("data/notes.json")
    .then((notes) => {
      const items = notes?.items || [];
      if (!items.length) return;
      const sec = $("#notes");
      sec.hidden = false;
      $("#notesMore").href = notes.url;
      const grid = $("#notesGrid");
      for (const n of items.slice(0, 6)) {
        const a = document.createElement("a");
        a.className = "note-card";
        a.href = n.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const thumb = document.createElement("div");
        thumb.className = "note-thumb";
        if (n.image) {
          const img = document.createElement("img");
          img.src = n.image;
          img.alt = "";
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          img.addEventListener("error", () => thumb.classList.add("no-image"), { once: true });
          thumb.appendChild(img);
        } else {
          thumb.classList.add("no-image");
        }
        const body = document.createElement("div");
        body.className = "note-body";
        const h = document.createElement("h3");
        h.className = "note-title";
        h.textContent = n.title;
        const p = document.createElement("p");
        p.className = "note-summary";
        p.textContent = n.summary || "";
        const t = document.createElement("time");
        t.className = "note-date";
        if (n.publishedAt) {
          t.dateTime = n.publishedAt;
          const d = new Date(n.publishedAt);
          t.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
        }
        body.append(h, p, t);
        a.append(thumb, body);
        grid.appendChild(a);
      }
    })
    .catch(() => {});
})();
