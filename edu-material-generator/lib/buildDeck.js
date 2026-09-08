// lib/buildDeck.js
// generateOutline() が返す構成データを、タイトルスライド・まとめスライドを含めた
// 「スライド一覧(配列)」に平坦化する。PPTX生成・画像生成・動画生成すべてがこの配列を共通で使う。

function buildDeck(outline) {
  const deck = [];

  const objectives = Array.isArray(outline.objectives) ? outline.objectives.filter(Boolean) : [];
  const titleNarration =
    `この講義では「${outline.title}」について学びます。` +
    (objectives.length > 0 ? `具体的には、${objectives.join("、")}について解説していきます。` : "");

  deck.push({
    kind: "title",
    title: outline.title,
    bullets: objectives,
    narration: titleNarration,
    icon: outline.icon || "idea",
    layout: "list",
  });

  for (const slide of outline.slides) {
    deck.push({
      kind: "content",
      title: slide.title,
      bullets: slide.bullets,
      narration: slide.narration,
      icon: slide.icon || "idea",
      layout: slide.layout || "list",
    });
  }

  const summary = outline.summary || {};
  deck.push({
    kind: "summary",
    title: summary.title || "まとめ",
    bullets: Array.isArray(summary.bullets) ? summary.bullets.filter(Boolean) : [],
    narration: summary.narration || "以上で今回の講義は終わりです。お疲れさまでした。",
    icon: summary.icon || "flag",
    layout: "list",
  });

  return deck;
}

module.exports = { buildDeck };
