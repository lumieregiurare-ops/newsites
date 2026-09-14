// カテゴリ判定: 収集元のカテゴリ情報 → タグ一致 → キーワード一致 の優先順。
// どれにも当たらないときは収集元の種類ごとの既定カテゴリ（ニュース・ギャラリー → 公式サイト、ローンチ系 → インディー）

export function createCategorizer(config) {
  const cats = config.categories.map((c) => ({
    id: c.id,
    label: c.label,
    ph: new Set((c.ph || []).map((s) => s.toLowerCase())),
    tags: new Set((c.tags || []).map((s) => s.toLowerCase())),
    keywords: (c.keywords || []).map((k) => new RegExp(k, "i")),
  }));
  const fallback = config.fallbackCategory;
  const defaults = config.defaultCategoryBySourceKind || {};
  const platforms = (config.platforms || []).map((p) => ({ id: p.id, label: p.label, re: new RegExp(p.pattern, "i") }));

  function labelOf(id) {
    return cats.find((c) => c.id === id)?.label || fallback.label;
  }

  function textOf(item) {
    return `${item.title || ""} ${item.headline || ""} ${item.description || ""} ${(item.tags || []).join(" ")}`;
  }

  function categorize(item) {
    const found = new Set();

    for (const slug of item.phCategories || []) {
      for (const c of cats) if (c.ph.has(slug.toLowerCase())) found.add(c.id);
    }
    for (const t of item.tags || []) {
      for (const c of cats) if (c.tags.has(t.toLowerCase())) found.add(c.id);
    }

    // キーワード: 1 件以上ヒットしたカテゴリを、ヒット数の多い順に最大 3 つ
    const text = textOf(item);
    const scores = cats
      .map((c) => ({ id: c.id, score: c.keywords.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const s of scores.slice(0, 3)) found.add(s.id);

    if (found.size === 0) {
      found.add(defaults[item.sourceKind] || fallback.id);
    }
    const ids = [...found].slice(0, 3);
    return { categories: ids, categoryLabels: ids.map(labelOf) };
  }

  function detectPlatforms(item) {
    const text = textOf(item);
    return platforms.filter((p) => p.re.test(text)).map((p) => p.id);
  }

  return {
    categorize,
    detectPlatforms,
    labelOf,
    all: [...cats.map((c) => ({ id: c.id, label: c.label })), { id: fallback.id, label: fallback.label }],
    platforms: platforms.map((p) => ({ id: p.id, label: p.label })),
  };
}
