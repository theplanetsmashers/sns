// lib/renderSlideImages.js
// 各スライドをHTML/CSSで描画し、Puppeteerでスクリーンショットして動画用のPNG画像を作る。
// 解像度は1280x720(720p)。スマホでの視聴やDiscordへの直接添付(ファイルサイズ)を優先し、
// フルHDより一段落とした軽量設定にしている。

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const WIDTH = 1280;
const HEIGHT = 720;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slideHtml(slide, index, total, creditText) {
  const bulletsHtml = (slide.bullets || [])
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join("\n");

  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    background: #ffffff;
    font-family: "Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif;
    color: #111827;
  }
  .slide { width: 100%; height: 100%; padding: 67px 93px; display: flex; flex-direction: column; }
  .accent-bar { width: 93px; height: 7px; background: #2563EB; border-radius: 4px; margin-bottom: 24px; }
  h1 { font-size: 37px; font-weight: 700; color: #1F2937; line-height: 1.35; margin-bottom: 33px; }
  ul { list-style: none; }
  li { font-size: 27px; line-height: 1.9; padding-left: 37px; position: relative; color: #1F2937; }
  li::before {
    content: "";
    position: absolute; left: 0; top: 13px;
    width: 15px; height: 15px; border-radius: 50%;
    background: #2563EB;
  }
  .title-wrap { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .title-wrap h1 { font-size: 56px; text-align: left; }
  .footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
  .footer .page { font-size: 17px; color: #9CA3AF; }
  .footer .credit { font-size: 15px; color: #9CA3AF; }
  .badge { display: inline-block; font-size: 17px; color: #2563EB; font-weight: 700; letter-spacing: 2px; margin-bottom: 13px; }
</style></head>
<body>
  <div class="slide">
    ${isTitle
      ? `<div class="title-wrap"><span class="badge">LECTURE</span><div class="accent-bar"></div><h1>${escapeHtml(slide.title)}</h1><ul>${bulletsHtml}</ul></div>`
      : `<div class="accent-bar"></div>${isSummary ? '<span class="badge">SUMMARY</span>' : ""}<h1>${escapeHtml(slide.title)}</h1><ul>${bulletsHtml}</ul>`}
    <div class="footer">
      <div class="credit">${creditText ? escapeHtml(creditText) : ""}</div>
      <div class="page">${index + 1} / ${total}</div>
    </div>
  </div>
</body></html>`;
}

async function renderSlideImages(deck, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const creditText = options.creditText || null;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const imagePaths = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    for (let i = 0; i < deck.length; i++) {
      const html = slideHtml(deck[i], i, deck.length, creditText);
      await page.setContent(html, { waitUntil: "load" });
      const filePath = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: filePath, type: "png" });
      imagePaths.push(filePath);
    }
  } finally {
    await browser.close();
  }

  return imagePaths;
}

module.exports = { renderSlideImages };
