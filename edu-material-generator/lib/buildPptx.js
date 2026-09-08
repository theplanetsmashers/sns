// lib/buildPptx.js
// pptxgenjsを使って、平坦化済みのスライド配列(buildDeck.jsの出力)から実際の.pptxファイルを作る。
// 動画用のHTML/CSSスライド(lib/renderSlideImages.js)と見た目・レイアウトを揃えている
// (トップバー・セクションごとのアクセントカラー・カード風の箇条書き・アイコンイラスト・
// 用語強調・バッジの影・process/calloutレイアウト)。講師が中身を見返したり手直しできるように、
// ナレーション原稿はスピーカーノートに入れる。

const PptxGenJS = require("pptxgenjs");
const { colorFor, CHECK_COLOR } = require("./palette");
const { renderIconPngs, cacheKeyFor } = require("./renderIconPng");

const TITLE_COLOR = "1F2937";
const TEXT_COLOR = "1F2937";
const BG_COLOR = "FFFFFF";
const MUTED_COLOR = "6B7280";
const ICON_PNG_SIZE = 240;

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

function toDataUri(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function addTopBar(s, accentHex) {
  s.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: accentHex }, line: { type: "none" } });
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

function addBadgeItem(s, index, text, badgeStyle, accentHex, y, w) {
  const badgeColor = badgeStyle === "check" ? CHECK_COLOR : accentHex;
  const badgeSize = 0.34;
  const badgeX = 0.6;
  const cardH = 0.62;

  s.addShape("roundRect", {
    x: 0.5,
    y: y - 0.1,
    w,
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
    x: badgeX + badgeSize + 0.26,
    y: y - 0.05,
    w: w - badgeSize - 0.6,
    h: 0.6,
    fontSize: 14,
    fontFace: "Meiryo",
    valign: "top",
    lineSpacingMultiple: 1.3,
  });
}

function addIconPanel(s, color, iconDataUri) {
  const cx = 11.05;
  const cy = 3.85;
  const outerR = 1.55;
  const innerR = 1.05;

  s.addShape("ellipse", {
    x: cx - outerR,
    y: cy - outerR,
    w: outerR * 2,
    h: outerR * 2,
    fill: { color: color.light },
    line: { type: "none" },
  });
  s.addShape("ellipse", {
    x: cx - innerR,
    y: cy - innerR,
    w: innerR * 2,
    h: innerR * 2,
    fill: { color: "FFFFFF" },
    line: { color: color.light, width: 1 },
    shadow: { type: "outer", color: "0F172A", opacity: 0.15, blur: 8, offset: 3, angle: 90 },
  });
  if (iconDataUri) {
    const iconSize = 1.15;
    s.addImage({ data: iconDataUri, x: cx - iconSize / 2, y: cy - iconSize / 2, w: iconSize, h: iconSize });
  }
}

function addListLayout(s, slide, color, badgeStyle, iconDataUri, meta) {
  addIconPanel(s, color, iconDataUri);

  let itemsStartY = slide.kind === "title" ? 2.6 : 2.15;
  if (slide.kind === "title" && meta) {
    s.addText(meta, { x: 0.6, y: 2.15, w: 8.9, h: 0.35, fontSize: 13, color: MUTED_COLOR, fontFace: "Meiryo" });
    itemsStartY = 2.85;
  }

  const itemGap = 0.78;
  (slide.bullets || []).forEach((b, i) => {
    addBadgeItem(s, i, b, badgeStyle, color.accent, itemsStartY + i * itemGap, 9.0);
  });
}

function addProcessLayout(s, slide, color) {
  const steps = (slide.bullets || []).slice(0, 4);
  const n = steps.length;
  const areaX = 0.6;
  const areaW = 12.1;
  const stepW = areaW / n;
  const badgeSize = 0.55;
  const y = 3.0;

  steps.forEach((text, i) => {
    const cx = areaX + stepW * i + stepW / 2;
    s.addShape("ellipse", {
      x: cx - badgeSize / 2,
      y,
      w: badgeSize,
      h: badgeSize,
      fill: { color: color.accent },
      line: { type: "none" },
      shadow: BADGE_SHADOW,
    });
    s.addText(String(i + 1), {
      x: cx - badgeSize / 2,
      y,
      w: badgeSize,
      h: badgeSize,
      align: "center",
      valign: "middle",
      fontSize: 16,
      bold: true,
      color: "FFFFFF",
      fontFace: "Meiryo",
    });
    s.addText(text, {
      x: cx - stepW / 2 + 0.1,
      y: y + badgeSize + 0.15,
      w: stepW - 0.2,
      h: 1.0,
      align: "center",
      fontSize: 13,
      color: TEXT_COLOR,
      fontFace: "Meiryo",
      lineSpacingMultiple: 1.25,
    });
    if (i < n - 1) {
      s.addText("›", {
        x: cx + stepW / 2 - 0.25,
        y: y - 0.08,
        w: 0.5,
        h: badgeSize,
        align: "center",
        valign: "middle",
        fontSize: 28,
        bold: true,
        color: color.accent,
        fontFace: "Arial",
      });
    }
  });
}

function addCalloutLayout(s, slide, color, iconDataUri) {
  const boxY = 2.3;
  const boxH = 1.9;
  s.addShape("roundRect", {
    x: 0.6,
    y: boxY,
    w: 12.1,
    h: boxH,
    rectRadius: 0.12,
    fill: { color: color.accent, transparency: 90 },
    line: { color: color.accent, width: 3, transparency: 40 },
  });
  const iconD = 1.3;
  const iconCx = 1.9;
  const iconCy = boxY + boxH / 2;
  s.addShape("ellipse", {
    x: iconCx - iconD / 2,
    y: iconCy - iconD / 2,
    w: iconD,
    h: iconD,
    fill: { color: color.accent },
    line: { type: "none" },
    shadow: BADGE_SHADOW,
  });
  if (iconDataUri) {
    const s2 = 0.7;
    s.addImage({ data: iconDataUri, x: iconCx - s2 / 2, y: iconCy - s2 / 2, w: s2, h: s2 });
  }
  s.addText((slide.bullets || []).join("。"), {
    x: 2.8,
    y: boxY + 0.2,
    w: 9.6,
    h: boxH - 0.4,
    fontSize: 18,
    bold: true,
    color: TEXT_COLOR,
    fontFace: "Meiryo",
    valign: "middle",
    lineSpacingMultiple: 1.4,
  });
}

function addCodeLayout(s, slide) {
  const lines = slide.bullets || [];
  const boxY = 2.15;
  const lineH = 0.5;
  const boxH = Math.min(0.7 + lines.length * lineH, 4.5);

  s.addShape("roundRect", {
    x: 0.6,
    y: boxY,
    w: 12.1,
    h: boxH,
    rectRadius: 0.1,
    fill: { color: "1E293B" },
    line: { type: "none" },
    shadow: { type: "outer", color: "0F172A", opacity: 0.3, blur: 6, offset: 2, angle: 90 },
  });

  const runs = [];
  lines.forEach((line, i) => {
    runs.push({ text: "$ ", options: { color: "34D399", bold: true, breakLine: false } });
    runs.push({ text: line, options: { color: "E2E8F0", breakLine: true } });
  });

  s.addText(runs, {
    x: 0.9,
    y: boxY + 0.3,
    w: 11.5,
    h: boxH - 0.5,
    fontSize: 13,
    fontFace: "Consolas",
    valign: "top",
    lineSpacingMultiple: 1.5,
  });
}

function addSlide(pptx, slide, index, total, meta, iconPngs) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLOR };

  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";
  const badgeStyle = isTitle || isSummary ? "check" : "num";
  const color = colorFor(slide, index);
  const eyebrow = isTitle ? "LECTURE" : isSummary ? "SUMMARY" : `POINT ${String(index).padStart(2, "0")}`;
  const layout = slide.layout || "list";

  addTopBar(s, color.accent);
  s.addShape("roundRect", {
    x: 0.25,
    y: 0.25,
    w: SLIDE_W - 0.5,
    h: SLIDE_H - 0.5,
    rectRadius: 0.15,
    fill: { type: "none" },
    line: { color: "0F172A", width: 0.75, transparency: 93 },
  });
  addEyebrow(s, eyebrow, color);

  s.addText(slide.title, {
    x: 0.6,
    y: 1.05,
    w: 11.8,
    h: isTitle ? 1.3 : 0.9,
    fontSize: isTitle ? 32 : 24,
    bold: true,
    color: TITLE_COLOR,
    fontFace: "Meiryo",
  });

  const iconBuf = iconPngs[cacheKeyFor(slide.icon, layout === "callout" ? "FFFFFF" : color.accent, ICON_PNG_SIZE)];
  const iconDataUri = iconBuf ? toDataUri(iconBuf) : null;

  if (layout === "process" && (slide.bullets || []).length >= 2) {
    addProcessLayout(s, slide, color);
  } else if (layout === "callout") {
    addCalloutLayout(s, slide, color, iconDataUri);
  } else if (layout === "code") {
    addCodeLayout(s, slide);
  } else {
    addListLayout(s, slide, color, badgeStyle, iconDataUri, meta);
  }

  if (slide.narration) {
    s.addNotes(slide.narration);
  }

  return s;
}

async function buildPptx(outline, deck, outputPath, options = {}) {
  const meta =
    options.totalSlides || options.totalMinutes
      ? `全${options.totalSlides}枚 ・ 想定時間 約${options.totalMinutes}分`
      : null;

  const iconRequests = deck.map((slide, i) => {
    const layout = slide.layout || "list";
    const color = colorFor(slide, i);
    return { key: slide.icon || "idea", color: layout === "callout" ? "FFFFFF" : color.accent, size: ICON_PNG_SIZE };
  });
  const iconPngs = await renderIconPngs(iconRequests);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";

  deck.forEach((slide, i) => addSlide(pptx, slide, i, deck.length, meta, iconPngs));

  return pptx.writeFile({ fileName: outputPath });
}

module.exports = { buildPptx };
