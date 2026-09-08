// lib/buildPptx.js
// pptxgenjsを使って、平坦化済みのスライド配列(buildDeck.jsの出力)から実際の.pptxファイルを作る。
// 講師が中身を見返したり、手直ししたりできるように、ナレーション原稿はスピーカーノートに入れる。

const PptxGenJS = require("pptxgenjs");

const COLORS = {
  title: "1F2937",
  accent: "2563EB",
  text: "111827",
  bg: "FFFFFF",
};

function addContentSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bg };

  s.addText(slide.title, {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 1,
    fontSize: 30,
    bold: true,
    color: COLORS.title,
    fontFace: "Meiryo",
  });

  s.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 1.3,
    w: 1.2,
    h: 0.05,
    fill: { color: COLORS.accent },
    line: { color: COLORS.accent },
  });

  if (slide.bullets && slide.bullets.length > 0) {
    s.addText(
      slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
      {
        x: 0.6,
        y: 1.8,
        w: 8.8,
        h: 4.8,
        fontSize: 20,
        color: COLORS.text,
        fontFace: "Meiryo",
        valign: "top",
        lineSpacingMultiple: 1.4,
      }
    );
  }

  if (slide.narration) {
    s.addNotes(slide.narration);
  }

  return s;
}

function buildPptx(outline, deck, outputPath) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";

  for (const slide of deck) {
    addContentSlide(pptx, slide);
  }

  return pptx.writeFile({ fileName: outputPath });
}

module.exports = { buildPptx };
