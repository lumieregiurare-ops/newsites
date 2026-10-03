// トップページ
(() => {
  const { $, esc, ext } = GL;
  const LATEST = 24;
  const PICKUP_HOURS = 72;

  // 注目ニュース: 画像があり、複数のメディアが報じたものや新しいものを優先する
  function choosePickup(news) {
    const now = Date.now();
    const bonus = { release: 1, teaser: 1.5, prereg: 1, anniversary: 0.5, event: 0.3 };
    const scored = news
      .filter((n) => n.image && now - new Date(n.publishedAt).getTime() < PICKUP_HOURS * 3600000)
      .map((n) => {
        const hours = (now - new Date(n.publishedAt).getTime()) / 3600000;
        const score = (n.sourceNames.length - 1) * 2.5 + (bonus[n.categories[0]] || 0) + (n.platforms.length ? 0.5 : 0) - hours / 18;
        return { n, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.n);
    // 足りないときは画像付きの新しい順で埋める
    for (const n of news) {
      if (scored.length >= 5) break;
      if (n.image && !scored.includes(n)) scored.push(n);
    }
    return scored.slice(0, 5);
  }

  function renderPickup(items) {
    const box = $("#pickup");
    if (!items.length) {
      box.hidden = true;
      return;
    }
    const [lead, ...subs] = items;
    box.innerHTML = `<a class="pickup-lead"${ext(lead.link)}>
  ${GL.thumb(lead.image)}
  <div class="pickup-text">
    <span class="pickup-label">${esc(lead.label)}</span>
    <h3>${esc(lead.title)}</h3>
    <p class="pickup-meta">${esc(lead.sourceName)} · ${GL.stamp(lead.publishedAt)}</p>
  </div>
</a>
<div class="pickup-subs">${subs
      .map(
        (n) => `<a class="pickup-sub"${ext(n.link)}>
  ${GL.thumb(n.image)}
  <div class="pickup-text"><h3>${esc(n.title)}</h3></div>
</a>`
      )
      .join("")}</div>`;
  }

  // 機種別タブ
  const PLATFORM_TABS = [
    { id: "mobile", label: "スマホ", test: (n) => n.platforms.includes("mobile") },
    { id: "switch", label: "Switch", test: (n) => n.platforms.includes("switch") || n.platforms.includes("switch2") },
    { id: "ps", label: "PlayStation", test: (n) => n.platforms.includes("ps") },
    { id: "xbox", label: "Xbox", test: (n) => n.platforms.includes("xbox") },
    { id: "pc", label: "PC", test: (n) => n.platforms.includes("pc") },
  ];

  function renderPlatformTabs(all) {
    const tabs = $("#platformTabs");
    const list = $("#platformList");
    const more = $("#platformMore");
    // ニュースを先に、App Store の新着アプリは後ろに回す
    const pool = [...all.filter((n) => n.isNews), ...all.filter((n) => !n.isNews)];
    const usable = PLATFORM_TABS.map((t) => ({ ...t, items: pool.filter(t.test).slice(0, 8) })).filter((t) => t.items.length);
    if (!usable.length) {
      $("#platformTitle").closest("section").hidden = true;
      return;
    }
    tabs.innerHTML = usable
      .map((t, i) => `<button class="tab" type="button" role="tab" data-i="${i}" aria-selected="${i === 0}">${esc(t.label)}</button>`)
      .join("");
    const draw = (i) => {
      const t = usable[i];
      tabs.querySelectorAll(".tab").forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
      const items = [...t.items].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      list.innerHTML = items.map(GL.miniRow).join("");
      more.href = `radar/?platform=${t.id}`;
      more.textContent = `${t.label}のニュースをもっと見る`;
    };
    tabs.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => draw(Number(b.dataset.i))));
    draw(0);
  }

  function renderPrereg(list) {
    const grid = $("#preregGrid");
    const items = [...(list || [])].sort((a, b) => (a.verified === false ? 1 : 0) - (b.verified === false ? 1 : 0)).slice(0, 8);
    grid.innerHTML = items.length ? items.map((p) => GL.preregCard(p)).join("") : `<p class="list-empty">現在受付中のタイトルはありません。</p>`;
  }

  // ---------- 読み込み ----------
  GL.getJson("radar/data/sites.json")
    .then((data) => {
      const all = data.items.map(GL.norm).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      const news = all.filter((n) => n.isNews);
      const pickup = choosePickup(news);
      renderPickup(pickup);
      const used = new Set(pickup.map((n) => n.id));
      $("#latest").innerHTML = GL.newsList(news.filter((n) => !used.has(n.id)).slice(0, LATEST));
      renderPlatformTabs(all);
      GL.renderCategoryBox($("#sideCats"), data);
    })
    .catch(() => {
      $("#pickup").hidden = true;
      $("#latest").innerHTML = `<p class="list-empty">ニュースを読み込めませんでした。時間をおいて再度お試しください。</p>`;
    });

  GL.getJson("data/schedule-top.json")
    .then((sched) => {
      GL.renderScheduleBox($("#sideSchedule"), sched);
      GL.renderChangesBox($("#sideChanges"), sched.changes);
      renderPrereg(sched.prereg);
    })
    .catch(() => {
      $("#sideSchedule").hidden = true;
      $("#sideChanges").hidden = true;
      $("#preregTitle").closest("section").hidden = true;
    });

  GL.renderRanking($("#ranking"));
})();
