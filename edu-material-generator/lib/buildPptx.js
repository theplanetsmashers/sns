// lib/buildPptx.js
// pptxgenjsを使って、平坦化済みのスライド配列(buildDeck.jsの出力)から実際の.pptxファイルを作る。
// 動画用のHTML/CSSスライド(lib/renderSlideImages.js)と見た目を揃えている
// (トップバー・セクションごとのアクセントカラー・カード風の箇条書き・用語強調・バッジの影)。
// 講師が中身を見返したり手直しできるように、ナレーション原稿はスピーカーノートに入れる。

const PptxGenJS = require("pptxgenjs");
const { colorFor, CHECK_COLOR } = require("./palette");

const TITLE_COLOR = "1F2937";
const TEXT_COLOR = "1F2937";
const BG_COLOR = "FFFFFF";
const MUTED_COLOR = "6B7280";

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

const BADGE_SHADOW = { type: "outer", color: "0F172A", opacity: 0.25, blur: 4, offset: 2, angle: 90 };

// 「用語:説明」のような文を検出して、pptxgenjsのtext-run配列(用語部分だけ強調)にする。
function formatBulletRuns(text, accentHex) {
  const str = String(text);
  const m = str.match(/^([^\d：:][^：:]{0,18})[：:]\s*(.+)$/s);
  if (m && m[2]) {
    return [
      { text: m[1], options: { bold: true, color: accentHex } },
      { text: ": ", options: { bold: true, color: accentHex } },
      { text: m[2], options: { color: TEXT_COLOR } },
    ];
  }
  return [{ text: str, options: { color: TEXT_COLOR } }];
}

function addTopBar(s, accentHex) {
  s.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: accentHex },
    line: { type: "none" },
  });
}

function addEyebrow(s, label, color) {
  s.addShape("roundRect", {
    x: 0.6,
    y: 0.5,
    w: 1.9,
    h: 0.4,
    rectRadius: 0.2,
    fill: { color: color.light },
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
    color: color.accent,
    fontFace: "Meiryo",
    charSpacing: 1,
  });
}

function addBadgeItem(s, index, text, badgeStyle, accentHex, y) {
  const badgeColor = badgeStyle === "check" ? CHECK_COLOR : accentHex;
  const badgeSize = 0.36;
  const badgeX = 0.6;
  const cardH = 0.62;

  s.addShape("roundRect", {
    x: 0.5,
    y: y - 0.1,
    w: 12.2,
    h: cardH,
    rectRadius: 0.08,
    fill: { color: accentHex, transparency: 94 },
    line: { type: "none" },
  });
  s.addShape("ellipse", {
    x: badgeX,
    y,
    w: badgeSize,
    h: badgeSize,
    fill: { color: badgeColor },
    line: { type: "none" },
    shadow: BADGE_SHADOW,
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
  s.addText(formatBulletRuns(text, accentHex), {
    x: badgeX + badgeSize + 0.28,
    y: y - 0.05,
    w: 11.1,
    h: 0.6,
    fontSize: 15,
    fontFace: "Meiryo",
    valign: "top",
    lineSpacingMultiple: 1.3,
  });
}

function addSlide(pptx, slide, index, total, meta) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLOR };

  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";
  const badgeStyle = isTitle || isSummary ? "check" : "num";
  const color = colorFor(slide, index);
  const eyebrow = isTitle ? "LECTURE" : isSummary ? "SUMMARY" : `POINT ${String(index).padStart(2, "0")}`;

  addTopBar(s, color.accent);

  if (isTitle) {
    s.addShape("ellipse", {
      x: SLIDE_W - 3.2,
      y: -1.8,
      w: 5,
      h: 5,
      fill: { color: color.light, transparency: 55 },
      line: { type: "none" },
    });
  }

  addEyebrow(s, eyebrow, color);

  s.addText(slide.title, {
    x: 0.6,
    y: 1.05,
    w: 11.8,
    h: isTitle ? 1.3 : 0.9,
    fontSize: isTitle ? 34 : 26,
    bold: true,
    color: TITLE_COLOR,
    fontFace: "Meiryo",
  });

  let itemsStartY = isTitle ? 2.6 : 2.15;
  if (isTitle && meta) {
    s.addText(meta, {
      x: 0.6,
      y: 2.15,
      w: 11.8,
      h: 0.35,
      fontSize: 13,
      color: MUTED_COLOR,
      fontFace: "Meiryo",
    });
    itemsStartY = 2.85;
  }

  const itemGap = 0.78;
  (slide.bullets || []).forEach((b, i) => {
    addBadgeItem(s, i, b, badgeStyle, color.accent, itemsStartY + i * itemGap);
  });

  if (slide.narration) {
    s.addNotes(slide.narration);
  }

  return s;
}

function buildPptx(outline, deck, outputPath, options = {}) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";

  const meta =
    options.totalSlides || options.totalMinutes
      ? `全${options.totalSlides}枚 ・ 想定時間 約${options.totalMinutes}分`
      : null;

  deck.forEach((slide, i) => addSlide(pptx, slide, i, deck.length, meta));

  return pptx.writeFile({ fileName: outputPath });
}

module.exports = { buildPptx };
