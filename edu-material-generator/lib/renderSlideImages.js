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
const { colorFor, CHECK_COLOR } = require("./palette");

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

// 「用語:説明」のような文を検出して、用語部分だけ強調表示する。
// 先頭が数字のコロン区切り(例: "10:30")は誤検出を避けるため対象外にする。
function formatBulletInner(text, accentHex) {
  const str = String(text);
  const m = str.match(/^([^\d：:][^：:]{0,18})[：:]\s*(.+)$/s);
  if (m && m[2]) {
    return `<strong style="color:#${accentHex}">${escapeHtml(m[1])}</strong><span style="color:#${accentHex}">:</span> ${escapeHtml(m[2])}`;
  }
  return escapeHtml(str);
}

function itemsHtml(bullets, badgeStyle, accentHex) {
  return (bullets || [])
    .map((b, i) => {
      const badgeInner = badgeStyle === "check" ? CHECK_ICON : `<span>${i + 1}</span>`;
      const badgeColor = badgeStyle === "check" ? CHECK_COLOR : accentHex;
      return `<div class="item" style="background:#${accentHex}0d;border-left-color:#${accentHex}">
        <div class="badge" style="background:#${badgeColor}">${badgeInner}</div>
        <div class="text">${formatBulletInner(b, accentHex)}</div>
      </div>`;
    })
    .join("\n");
}

function progressHtml(index, total, accentHex) {
  const segs = Array.from({ length: total }, (_, i) => {
    const style = i === index ? `background:#${accentHex}` : "";
    return `<div class="seg${i === index ? " active" : ""}" style="${style}"></div>`;
  }).join("");
  return `<div class="progress">${segs}</div>`;
}

function slideHtml(slide, index, total, options) {
  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";
  const badgeStyle = isTitle || isSummary ? "check" : "num";
  const color = colorFor(slide, index);
  const items = itemsHtml(slide.bullets, badgeStyle, color.accent);
  const eyebrowLabel = isTitle ? "LECTURE" : isSummary ? "SUMMARY" : `POINT ${String(index).padStart(2, "0")}`;
  const creditText = options.creditText || null;
  const metaLine =
    isTitle && (options.totalSlides || options.totalMinutes)
      ? `<div class="meta">全${options.totalSlides}枚 ・ 想定時間 約${options.totalMinutes}分</div>`
      : "";

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
  .topbar { height: 8px; background: #${color.accent}; }
  .texture {
    position: absolute; inset: 0;
    background-image: radial-gradient(rgba(15,23,42,0.05) 1px, transparent 1px);
    background-size: 26px 26px;
    z-index: 0;
  }
  .blob {
    position: absolute; top: -140px; right: -140px; width: 460px; height: 460px;
    border-radius: 50%; background: radial-gradient(circle at 30% 30%, #${color.light}, rgba(255,255,255,0) 70%);
    z-index: 0;
  }
  .content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 40px 88px; }
  .eyebrow {
    display: inline-flex; align-self: flex-start; align-items: center; gap: 8px;
    background: #${color.light}; color: #${color.accent}; font-weight: 700; font-size: 15px; letter-spacing: 2px;
    padding: 7px 16px; border-radius: 999px; margin-bottom: 22px;
  }
  .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: #${color.accent}; }
  h1 { font-weight: 700; color: #1F2937; line-height: 1.35; letter-spacing: 0.3px; margin-bottom: 14px; }
  .content h1 { font-size: 34px; }
  .title-slide h1 { font-size: 54px; }
  .meta { font-size: 16px; color: #6B7280; margin-bottom: 26px; }
  .title-slide .items { margin-top: 12px; }
  .items { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; }
  .item {
    display: flex; align-items: flex-start; gap: 16px;
    border-radius: 12px; border-left: 4px solid transparent;
    padding: 14px 18px;
  }
  .badge {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700; color: #ffffff;
    box-shadow: 0 3px 6px rgba(15, 23, 42, 0.22);
  }
  .item .text { font-size: 22px; line-height: 1.55; color: #1F2937; padding-top: 3px; }
  .footer {
    position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center;
    padding: 20px 88px; border-top: 1px solid #F1F5F9;
  }
  .footer .credit { font-size: 15px; color: #6B7280; }
  .footer .right { display: flex; align-items: center; gap: 14px; }
  .progress { display: flex; gap: 6px; }
  .progress .seg { width: 26px; height: 6px; border-radius: 3px; background: #E2E8F0; }
  .footer .page { font-size: 15px; color: #6B7280; min-width: 44px; text-align: right; }
</style></head>
<body>
  <div class="slide${isTitle ? " title-slide" : ""}">
    <div class="topbar"></div>
    <div class="texture"></div>
    ${isTitle ? '<div class="blob"></div>' : ""}
    <div class="content">
      <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrowLabel)}</div>
      <h1>${escapeHtml(slide.title)}</h1>
      ${metaLine}
      <div class="items">${items}</div>
    </div>
    <div class="footer">
      <div class="credit">${creditText ? escapeHtml(creditText) : ""}</div>
      <div class="right">
        ${progressHtml(index, total, color.accent)}
        <div class="page">${index + 1} / ${total}</div>
      </div>
    </div>
  </div>
</body></html>`;
}

async function renderSlideImages(deck, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const imagePaths = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    for (let i = 0; i < deck.length; i++) {
      const html = slideHtml(deck[i], i, deck.length, options);
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
