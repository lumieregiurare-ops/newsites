// 発売スケジュールページ
(() => {
  const { $, esc, ext } = GL;
  const PAGE = 120;
  const SOURCE_GROUPS = [
    { id: "all", label: "すべて" },
    { id: "news", label: "ニュースで発表", test: (r) => !/^(Nintendo|Steam)$/.test(r.source) },
    { id: "nintendo", label: "ニンテンドーeショップ", test: (r) => r.source === "Nintendo" },
    { id: "steam", label: "Steam", test: (r) => r.source === "Steam" },
  ];
  let sched = { releases: [], platforms: [], changes: [] };
  let platform = "all";
  let source = "all";
  let shown = PAGE;

  const matchPlatform = (r, id) => id === "all" || (id === "switch" ? r.platforms.includes("switch") || r.platforms.includes("switch2") : r.platforms.includes(id));

  function renderFilters() {
    const group = SOURCE_GROUPS.find((g) => g.id === source);
    const inSource = sched.releases.filter((r) => !group?.test || group.test(r));
    const tabs = [{ id: "all", label: "すべて" }];
    for (const p of sched.platforms || []) {
      if (p.id === "switch2") continue;
      if (inSource.some((r) => matchPlatform(r, p.id)) || platform === p.id) tabs.push({ id: p.id, label: p.id === "switch" ? "Switch" : p.label });
    }
    $("#platformTabs").innerHTML = tabs
      .map(
        (t) =>
          `<button class="tab" type="button" role="tab" data-p="${esc(t.id)}" aria-selected="${platform === t.id}">${esc(t.label)}<small>${
            inSource.filter((r) => matchPlatform(r, t.id)).length
          }</small></button>`
      )
      .join("");
    $("#platformTabs")
      .querySelectorAll(".tab")
      .forEach((b) =>
        b.addEventListener("click", () => {
          platform = b.dataset.p;
          shown = PAGE;
          renderFilters();
          renderReleases();
        })
      );

    $("#sourceFilters").innerHTML = SOURCE_GROUPS.map(
      (g) => `<button class="chip${source === g.id ? " active" : ""}" type="button" data-s="${g.id}">${esc(g.label)}</button>`
    ).join("");
    $("#sourceFilters")
      .querySelectorAll(".chip")
      .forEach((b) =>
        b.addEventListener("click", () => {
          source = b.dataset.s;
          shown = PAGE;
          renderFilters();
          renderReleases();
        })
      );
  }

  function row(r, first) {
    let date = "";
    let cls = "";
    if (r.date) {
      const p = GL.dateParts(r.date);
      cls = p.w === 0 ? " sun" : p.w === 6 ? " sat" : "";
      date = `<b>${p.d}</b><span>${GL.WD[p.w]}曜</span>`;
    } else {
      cls = " is-tba";
      date = `<b>${esc(r.dateText.replace(/^\d{4}年/, ""))}</b>`;
    }
    let until = "";
    let rowCls = first ? "" : " is-cont";
    if (r.date) {
      const days = GL.daysUntil(r.date);
      if (days === 0) {
        until = "本日発売";
        rowCls += " is-today";
      } else if (days === 1) until = "明日発売";
      else if (days > 1 && days <= 14) until = `あと${days}日`;
    }
    const sub = [];
    if (until) sub.push(`<span class="until">${until}</span>`);
    if (r.maker) sub.push(`<span>${esc(r.maker)}</span>`);
    if (r.price) sub.push(`<span>${r.price.toLocaleString()}円</span>`);
    if (r.headline) sub.push(`<a class="hl"${ext(r.sourceUrl || r.url)}>${esc(r.headline)}</a>`);
    if (r.source && !r.headline) sub.push(`<span>${esc(r.source === "Nintendo" ? "ニンテンドーeショップ" : r.source)}</span>`);
    const note = r.dateSource === "appstore" ? ` title="App Store の配信予定日${r.announcedText ? `（発表時は ${esc(r.announcedText)}）` : ""}"` : "";
    return `<div class="srow${rowCls}">
  <div class="srow-date${cls}"${note}>${date}</div>
  <a class="thumb-link"${ext(r.url)} tabindex="-1" aria-hidden="true">${GL.thumb(GL.safeUrl(r.image))}</a>
  <div>
    <h3 class="srow-title"><a${ext(r.url)}>${esc(r.title)}</a></h3>
    <div class="srow-sub">${GL.pfTags(r.platforms, 5)}${sub.join("")}</div>
  </div>
</div>`;
  }

  function renderReleases() {
    const list = $("#scheduleList");
    const more = $("#scheduleMore");
    const group = SOURCE_GROUPS.find((g) => g.id === source);
    const all = sched.releases.filter((r) => matchPlatform(r, platform) && (!group?.test || group.test(r)));
    $("#countLine").textContent = `${all.length} タイトル`;
    if (!all.length) {
      list.innerHTML = `<p class="list-empty">該当するタイトルはありません。</p>`;
      more.hidden = true;
      return;
    }
    // 一度に数百行を描くと重くなるので、先頭から順に足していく
    const rows = all.slice(0, shown);
    more.hidden = all.length <= rows.length;
    more.textContent = `さらに表示（残り ${all.length - rows.length} 件）`;

    const monthKey = (r) => (r.date ? r.date.slice(0, 7) : `tba:${r.dateText}`);
    const monthTotal = new Map();
    for (const r of all) monthTotal.set(monthKey(r), (monthTotal.get(monthKey(r)) || 0) + 1);
    const months = new Map();
    for (const r of rows) {
      const key = r.date ? r.date.slice(0, 7) : `tba:${r.dateText}`;
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(r);
    }
    let html = "";
    for (const [key, items] of months) {
      html += /^\d{4}-\d{2}$/.test(key)
        ? `<h2 class="month-head">${Number(key.slice(5))}月<small>${key.slice(0, 4)}年 · ${monthTotal.get(key)}タイトル</small></h2>`
        : `<h2 class="month-head">${esc(key.slice(4))}<small>日付未定 · ${monthTotal.get(key)}タイトル</small></h2>`;
      let prev = "";
      for (const r of items) {
        const d = r.date || r.dateText;
        html += row(r, d !== prev);
        prev = d;
      }
    }
    list.innerHTML = html;
  }

  function renderChanges() {
    const list = $("#changesList");
    const changes = sched.changes || [];
    list.innerHTML = changes.length
      ? changes.map(GL.changeItem).join("")
      : `<li class="list-empty">直近の変更はありません。</li>`;
  }

  $("#scheduleMore").addEventListener("click", () => {
    shown += PAGE;
    renderReleases();
  });

  GL.getJson("data/schedule.json")
    .then((s) => {
      sched = { releases: [], platforms: [], changes: [], ...s };
      sched.releases = sched.releases.map((r) => ({ ...r, platforms: r.platforms || [] }));
      renderFilters();
      renderReleases();
      renderChanges();
    })
    .catch(() => {
      $("#scheduleList").innerHTML = `<p class="list-empty">スケジュールを読み込めませんでした。時間をおいて再度お試しください。</p>`;
    });

  GL.getJson("data/prereg.json")
    .then((p) => GL.renderPreregBox($("#sidePrereg"), p.prereg, 8))
    .catch(() => ($("#sidePrereg").hidden = true));
  GL.renderRanking($("#ranking"));
})();
