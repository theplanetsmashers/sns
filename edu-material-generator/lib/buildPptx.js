// lib/buildPptx.js
// pptxgenjsを使って、平坦化済みのスライド配列(buildDeck.jsの出力)から実際の.pptxファイルを作る。
// 動画用のHTML/CSSスライド(lib/renderSlideImages.js)と見た目を揃えている
// (eyebrowバッジ・丸番号/チェックの箇条書き)。講師が中身を見返したり手直しできるように、
// ナレーション原稿はスピーカーノートに入れる。

const PptxGenJS = require("pptxgenjs");

const COLORS = {
  title: "1F2937",
  accent: "2563EB",
  accentLight: "EEF2FF",
  check: "059669",
  text: "1F2937",
  bg: "FFFFFF",
  blob: "DBEAFE",
};

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

function addEyebrow(s, label) {
  s.addShape("roundRect", {
    x: 0.6,
    y: 0.5,
    w: 1.9,
    h: 0.4,
    rectRadius: 0.2,
    fill: { color: COLORS.accentLight },
    line: { type: "none" },
  });
  s.addText(label, {
    x: 0.6,
    y: 0.5,
    w: 1.9,
    h: 0.4,
    align: "center",
    valign: "middle",
    fontSize: 11,
    bold: true,
    color: COLORS.accent,
    fontFace: "Meiryo",
    charSpacing: 1,
  });
}

function addBadgeItem(s, index, text, badgeStyle, y) {
  const badgeColor = badgeStyle === "check" ? COLORS.check : COLORS.accent;
  const badgeSize = 0.36;
  const badgeX = 0.6;

  s.addShape("ellipse", {
    x: badgeX,
    y,
    w: badgeSize,
    h: badgeSize,
    fill: { color: badgeColor },
    line: { type: "none" },
  });
  s.addText(badgeStyle === "check" ? "✓" : String(index + 1), {
    x: badgeX,
    y,
    w: badgeSize,
    h: badgeSize,
    align: "center",
    valign: "middle",
    fontSize: 12,
    bold: true,
    color: "FFFFFF",
    fontFace: "Meiryo",
  });
  s.addText(text, {
    x: badgeX + badgeSize + 0.28,
    y: y - 0.05,
    w: 11.3,
    h: 0.6,
    fontSize: 15,
    color: COLORS.text,
    fontFace: "Meiryo",
    valign: "top",
    lineSpacingMultiple: 1.3,
  });
}

function addSlide(pptx, slide, index, total) {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };

  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";
  const badgeStyle = isTitle || isSummary ? "check" : "num";
  const eyebrow = isTitle ? "LECTURE" : isSummary ? "SUMMARY" : `POINT ${String(index).padStart(2, "0")}`;

  if (isTitle) {
    s.addShape("ellipse", {
      x: SLIDE_W - 3.2,
      y: -1.8,
      w: 5,
      h: 5,
      fill: { color: COLORS.blob, transparency: 55 },
      line: { type: "none" },
    });
  }

  addEyebrow(s, eyebrow);

  s.addText(slide.title, {
    x: 0.6,
    y: 1.05,
    w: 11.8,
    h: isTitle ? 1.3 : 0.9,
    fontSize: isTitle ? 34 : 26,
    bold: true,
    color: COLORS.title,
    fontFace: "Meiryo",
  });

  const itemsStartY = isTitle ? 2.6 : 2.15;
  const itemGap = 0.72;
  (slide.bullets || []).forEach((b, i) => {
    addBadgeItem(s, i, b, badgeStyle, itemsStartY + i * itemGap);
  });

  if (slide.narration) {
    s.addNotes(slide.narration);
  }

  return s;
}

function buildPptx(outline, deck, outputPath) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";

  deck.forEach((slide, i) => addSlide(pptx, slide, i, deck.length));

  return pptx.writeFile({ fileName: outputPath });
}

module.exports = { buildPptx };
