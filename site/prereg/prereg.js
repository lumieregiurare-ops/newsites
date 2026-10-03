// 事前登録ページ
(() => {
  const { $, esc } = GL;
  let list = [];
  let filter = "all";
  const FILTERS = [
    { id: "all", label: "すべて" },
    { id: "dated", label: "配信日決定", test: (p) => !!p.releaseText },
    { id: "tba", label: "配信日未定", test: (p) => !p.releaseText },
    { id: "store", label: "App Storeで予約可", test: (p) => !!p.appStore?.preorder },
  ];

  // 配信日が近いものを先に。未定は最後にまとめ、その中では新しく見つけた順（未確認はさらに後ろ）
  function sortKey(p) {
    const m = (p.releaseText || "").match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) return `0-${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const m2 = (p.releaseText || "").match(/(\d{4})年(\d{1,2})月/);
    if (m2) return `1-${m2[1]}-${m2[2].padStart(2, "0")}`;
    if (p.releaseText) return `2-${p.releaseText}`;
    return `${p.verified === false ? 4 : 3}-${99999999999999 - new Date(p.startedAt).getTime()}`;
  }

  function renderFilters() {
    const box = $("#dateFilters");
    box.innerHTML = FILTERS.map((f) => {
      const n = f.test ? list.filter(f.test).length : list.length;
      return `<button class="chip${filter === f.id ? " active" : ""}" type="button" data-f="${f.id}">${esc(f.label)}<span class="n">${n}</span></button>`;
    }).join("");
    box.querySelectorAll(".chip").forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.f;
        renderFilters();
        render();
      })
    );
  }

  function render() {
    const f = FILTERS.find((x) => x.id === filter);
    const items = list.filter((p) => !f?.test || f.test(p)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    $("#countLine").textContent = `${items.length} タイトル`;
    $("#preregGrid").innerHTML = items.length
      ? items.map((p) => GL.preregCard(p, { full: true })).join("")
      : `<p class="list-empty">該当するタイトルはありません。</p>`;
  }

  GL.getJson("data/prereg.json")
    .then((d) => {
      list = d.prereg || [];
      renderFilters();
      render();
    })
    .catch(() => {
      $("#preregGrid").innerHTML = `<p class="list-empty">読み込めませんでした。時間をおいて再度お試しください。</p>`;
    });

  GL.getJson("data/schedule-top.json")
    .then((s) => GL.renderScheduleBox($("#sideSchedule"), s))
    .catch(() => ($("#sideSchedule").hidden = true));
  GL.renderRanking($("#ranking"));
})();
