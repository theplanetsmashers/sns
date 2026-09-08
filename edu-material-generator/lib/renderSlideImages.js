// lib/renderSlideImages.js
// 各スライドをHTML/CSSで描画し、Puppeteerでスクリーンショットして動画用のPNG画像を作る。
// 解像度は1280x720(720p)。スマホでの視聴やDiscordへの直接添付(ファイルサイズ)を優先し、
// フルHDより一段落とした軽量設定にしている。
//
// 日本語テキストを描画するので、実行環境に日本語フォント(例: Noto Sans CJK JP)が
// 入っていないと文字化け(トーフ/□□□)になる。GitHub Actionsのワークフロー側で
// フォントをインストールしてから呼び出すこと。

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const WIDTH = 1280;
const HEIGHT = 720;

const FONT_STACK =
  '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// チェックのSVGアイコン(objectives/summaryスライド用)
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function itemsHtml(bullets, badgeStyle) {
  return (bullets || [])
    .map((b, i) => {
      const badgeInner = badgeStyle === "check" ? CHECK_ICON : `<span>${i + 1}</span>`;
      const badgeClass = badgeStyle === "check" ? "badge badge-check" : "badge badge-num";
      return `<div class="item"><div class="${badgeClass}">${badgeInner}</div><div class="text">${escapeHtml(b)}</div></div>`;
    })
    .join("\n");
}

function progressHtml(index, total) {
  const segs = Array.from({ length: total }, (_, i) => `<div class="seg${i === index ? " active" : ""}"></div>`).join("");
  return `<div class="progress">${segs}</div>`;
}

function slideHtml(slide, index, total, creditText) {
  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";
  const badgeStyle = isTitle || isSummary ? "check" : "num";
  const items = itemsHtml(slide.bullets, badgeStyle);
  const eyebrowLabel = isTitle ? "LECTURE" : isSummary ? "SUMMARY" : `POINT ${String(index).padStart(2, "0")}`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    background: #ffffff;
    font-family: ${FONT_STACK};
    color: #111827;
  }
  .slide { position: relative; width: 100%; height: 100%; overflow: hidden; display: flex; flex-direction: column; }
  .blob {
    position: absolute; top: -140px; right: -140px; width: 460px; height: 460px;
    border-radius: 50%; background: radial-gradient(circle at 30% 30%, #DBEAFE, rgba(219,234,254,0) 70%);
    z-index: 0;
  }
  .content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; padding: 60px 88px 0; }
  .eyebrow {
    display: inline-flex; align-self: flex-start; align-items: center; gap: 8px;
    background: #EEF2FF; color: #2563EB; font-weight: 700; font-size: 15px; letter-spacing: 2px;
    padding: 7px 16px; border-radius: 999px; margin-bottom: 22px;
  }
  .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: #2563EB; }
  h1 { font-weight: 700; color: #1F2937; line-height: 1.35; margin-bottom: 30px; }
  .content h1 { font-size: 34px; }
  .title-slide .content { justify-content: center; padding-top: 0; }
  .title-slide h1 { font-size: 54px; margin-bottom: 34px; }
  .items { display: flex; flex-direction: column; gap: 16px; }
  .item { display: flex; align-items: flex-start; gap: 18px; }
  .badge {
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 700; color: #ffffff; margin-top: 2px;
  }
  .badge-num { background: #2563EB; }
  .badge-check { background: #059669; }
  .item .text { font-size: 23px; line-height: 1.55; color: #1F2937; padding-top: 2px; }
  .footer {
    position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center;
    padding: 22px 88px; border-top: 1px solid #F1F5F9;
  }
  .footer .credit { font-size: 14px; color: #9CA3AF; }
  .footer .right { display: flex; align-items: center; gap: 14px; }
  .progress { display: flex; gap: 6px; }
  .progress .seg { width: 26px; height: 5px; border-radius: 3px; background: #E5E7EB; }
  .progress .seg.active { background: #2563EB; }
  .footer .page { font-size: 15px; color: #9CA3AF; min-width: 44px; text-align: right; }
</style></head>
<body>
  <div class="slide${isTitle ? " title-slide" : ""}">
    ${isTitle ? '<div class="blob"></div>' : ""}
    <div class="content">
      <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrowLabel)}</div>
      <h1>${escapeHtml(slide.title)}</h1>
      <div class="items">${items}</div>
    </div>
    <div class="footer">
      <div class="credit">${creditText ? escapeHtml(creditText) : ""}</div>
      <div class="right">
        ${progressHtml(index, total)}
        <div class="page">${index + 1} / ${total}</div>
      </div>
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
