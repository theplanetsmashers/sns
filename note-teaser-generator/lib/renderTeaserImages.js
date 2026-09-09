// lib/renderTeaserImages.js
// 台本の各シーンをHTML/CSSで描画し、Puppeteerでスクリーンショットして動画用のPNG画像を作る。
// 既定は縦型(1080x1920 = YouTube Shorts想定)。横型(1920x1080)にも切り替え可能。
//
// 日本語テキストを描画するので、実行環境に日本語フォント(例: Noto Sans CJK JP)が
// 入っていないと文字化け(トーフ/□□□)になる。GitHub Actionsのワークフロー側で
// フォントをインストールしてから呼び出すこと。

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const NAVY = "1E3A5F";
const ORANGE = "F97316";
const TEAL = "0F766E";
const ACCENTS = [NAVY, TEAL, NAVY, TEAL, NAVY, TEAL]; // シーンごとに交互(最終シーンはCTAとして別扱い)

const FONT_STACK =
  '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sceneHtml(scene, index, total, dims, options) {
  const isCta = index === total - 1;
  const accent = isCta ? ORANGE : ACCENTS[index % ACCENTS.length];
  const { width, height } = dims;
  const textSize = Math.round(width * (scene.text.length > 14 ? 0.075 : 0.095));
  const noteTitle = options.noteTitle || "";

  const dots = Array.from(
    { length: total },
    (_, i) => `<div class="dot${i === index ? " active" : ""}"></div>`
  ).join("");

  const body = isCta
    ? `<div class="cta">
        <div class="cta-badge">note</div>
        <h1 class="cta-text">${escapeHtml(scene.text)}</h1>
        ${noteTitle ? `<div class="cta-note-title">${escapeHtml(noteTitle)}</div>` : ""}
      </div>`
    : `<div class="main">
        <div class="kicker"><span class="dot-mark"></span>${escapeHtml(
          index === 0 ? "STORY" : `POINT ${index}`
        )}</div>
        <h1 class="text" style="font-size:${textSize}px">${escapeHtml(scene.text)}</h1>
      </div>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${width}px; height: ${height}px;
    font-family: ${FONT_STACK};
    background: ${isCta ? `#${accent}` : "#ffffff"};
    color: ${isCta ? "#ffffff" : "#111827"};
    overflow: hidden;
  }
  .screen { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; }
  .topbar { height: ${Math.round(height * 0.012)}px; background: #${accent}; }
  .texture {
    position: absolute; inset: 0;
    background-image: radial-gradient(rgba(15,23,42,${isCta ? "0.08" : "0.05"}) 1.5px, transparent 1.5px);
    background-size: 34px 34px;
    z-index: 0;
  }
  .main {
    position: relative; z-index: 1; flex: 1;
    display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
    padding: ${Math.round(width * 0.09)}px;
    gap: ${Math.round(height * 0.03)}px;
  }
  .kicker {
    display: inline-flex; align-items: center; gap: 10px;
    background: #${accent}1a; color: #${accent}; font-weight: 700;
    font-size: ${Math.round(width * 0.032)}px; letter-spacing: 2px;
    padding: 10px 22px; border-radius: 999px;
  }
  .dot-mark { width: 8px; height: 8px; border-radius: 50%; background: #${accent}; }
  .text {
    font-weight: 800; line-height: 1.45; letter-spacing: 0.5px; color: #1F2937;
    white-space: pre-wrap;
  }
  .cta {
    position: relative; z-index: 1; flex: 1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: ${Math.round(height * 0.035)}px;
    padding: ${Math.round(width * 0.1)}px; text-align: center;
  }
  .cta-badge {
    font-weight: 800; font-size: ${Math.round(width * 0.07)}px; letter-spacing: 1px;
    background: #ffffff; color: #${accent}; padding: 10px 34px; border-radius: 999px;
    box-shadow: 0 10px 28px rgba(0,0,0,0.18);
  }
  .cta-text {
    font-weight: 800; font-size: ${Math.round(width * 0.1)}px; line-height: 1.4;
    white-space: pre-wrap;
  }
  .cta-note-title {
    font-size: ${Math.round(width * 0.032)}px; line-height: 1.6; opacity: 0.9;
    max-width: 88%;
  }
  .footer {
    position: relative; z-index: 1; display: flex; align-items: center; justify-content: center;
    gap: 10px; padding-bottom: ${Math.round(height * 0.045)}px;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: ${isCta ? "rgba(255,255,255,0.35)" : "#E2E8F0"}; }
  .dot.active { background: #${isCta ? "ffffff" : accent}; }
</style></head>
<body>
  <div class="screen">
    <div class="topbar"></div>
    <div class="texture"></div>
    ${body}
    <div class="footer">${dots}</div>
  </div>
</body></html>`;
}

async function renderTeaserImages(scenes, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const vertical = options.vertical !== false;
  const dims = vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  const imagePaths = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: dims.width, height: dims.height });

    for (let i = 0; i < scenes.length; i++) {
      const html = sceneHtml(scenes[i], i, scenes.length, dims, options);
      await page.setContent(html, { waitUntil: "load" });
      const filePath = path.join(outDir, `scene-${String(i + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: filePath, type: "png" });
      imagePaths.push(filePath);
    }
  } finally {
    await browser.close();
  }

  return imagePaths;
}

module.exports = { renderTeaserImages };
