// lib/renderTeaserImages.js
// 台本の各シーンをHTML/CSSで描画し、Puppeteerでスクリーンショットして動画用のPNG画像を作る。
// 既定は縦型(1080x1920 = YouTube Shorts想定)。横型(1920x1080)にも切り替え可能。
//
// 「文字だけの画面」にしないため、各シーンは背景に絵(AI生成イラスト、なければアイコン+
// グラデーションの装飾)を敷き、その上に字幕(テロップ)としてキャプションを乗せる構成にしている。
//
// 日本語テキストを描画するので、実行環境に日本語フォント(例: Noto Sans CJK JP)が
// 入っていないと文字化け(トーフ/□□□)になる。GitHub Actionsのワークフロー側で
// フォントをインストールしてから呼び出すこと。

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { renderIconSvg } = require("./icons");

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

function fileToDataUri(filePath) {
  if (!filePath) return null;
  try {
    const buf = fs.readFileSync(filePath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function sceneHtml(scene, index, total, dims, options) {
  const isCta = index === total - 1;
  const accent = isCta ? ORANGE : ACCENTS[index % ACCENTS.length];
  const { width, height } = dims;
  const artUri = options.artDataUris && options.artDataUris[index];
  const noteTitle = options.noteTitle || "";

  const kickerLabel = isCta ? "note" : index === 0 ? "STORY" : `POINT ${index}`;
  const iconSize = Math.round(width * 0.5);
  const decoIcon = renderIconSvg(scene.icon, {
    size: iconSize,
    color: artUri ? "ffffff" : accent,
    strokeWidth: 1.2,
  });

  const dots = Array.from(
    { length: total },
    (_, i) => `<div class="dot${i === index ? " active" : ""}"></div>`
  ).join("");

  const background = artUri
    ? `<img class="art" src="${artUri}" />`
    : `<div class="deco-icon">${decoIcon}</div>`;

  const noteRow =
    isCta && noteTitle
      ? `<div class="note-title">${escapeHtml(noteTitle)}</div>`
      : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${width}px; height: ${height}px;
    font-family: ${FONT_STACK};
    background: ${artUri ? "#0f172a" : isCta ? `#${accent}` : "#ffffff"};
    color: #ffffff;
    overflow: hidden;
  }
  .screen { position: relative; width: 100%; height: 100%; }
  .topbar { position: absolute; top: 0; left: 0; right: 0; height: ${Math.round(height * 0.012)}px; background: #${accent}; z-index: 3; }
  .art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
  .texture {
    position: absolute; inset: 0; z-index: 0;
    background-image: radial-gradient(rgba(255,255,255,${artUri ? "0.06" : "0.08"}) 1.5px, transparent 1.5px);
    background-size: 34px 34px;
  }
  .deco-icon {
    position: absolute; top: 6%; right: -8%; z-index: 0;
    opacity: ${isCta ? 0.16 : 0.1}; transform: rotate(-6deg);
  }
  .scrim {
    position: absolute; inset: 0; z-index: 1;
    background: linear-gradient(180deg, rgba(15,23,42,${artUri ? 0.12 : 0}) 0%, rgba(15,23,42,${artUri ? 0.35 : 0}) 55%, rgba(15,23,42,${artUri ? 0.82 : isCta ? 0.05 : 0}) 100%);
  }
  .kicker-wrap { position: absolute; top: ${Math.round(height * 0.06)}px; left: ${Math.round(width * 0.08)}px; z-index: 2; }
  .kicker {
    display: inline-flex; align-items: center; gap: 10px;
    background: ${artUri || isCta ? "rgba(255,255,255,0.18)" : `#${accent}1a`};
    color: ${artUri || isCta ? "#ffffff" : `#${accent}`};
    font-weight: 700; font-size: ${Math.round(width * 0.032)}px; letter-spacing: 2px;
    padding: 9px 20px; border-radius: 999px;
  }
  .dot-mark { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
  .telop-wrap {
    position: absolute; left: 0; right: 0; bottom: ${Math.round(height * 0.1)}px; z-index: 2;
    padding: 0 ${Math.round(width * 0.08)}px;
  }
  .telop-bar {
    background: ${artUri ? "rgba(15,23,42,0.5)" : isCta ? "rgba(255,255,255,0.14)" : `#${accent}12`};
    border-left: 6px solid ${artUri || isCta ? "rgba(255,255,255,0.85)" : `#${accent}`};
    border-radius: 4px 20px 20px 4px;
    padding: ${Math.round(height * 0.032)}px ${Math.round(width * 0.055)}px;
  }
  .telop-text {
    font-weight: 800; line-height: 1.5; letter-spacing: 0.5px; white-space: pre-wrap;
    color: ${artUri || isCta ? "#ffffff" : "#1F2937"};
    font-size: ${Math.round(width * (scene.text.length > 14 ? 0.062 : 0.078))}px;
  }
  .note-title {
    margin-top: 14px; font-size: ${Math.round(width * 0.028)}px; line-height: 1.6;
    color: ${artUri || isCta ? "rgba(255,255,255,0.85)" : "#4B5563"};
  }
  .footer {
    position: absolute; left: 0; right: 0; bottom: ${Math.round(height * 0.03)}px; z-index: 2;
    display: flex; align-items: center; justify-content: center; gap: 10px;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: ${artUri || isCta ? "rgba(255,255,255,0.35)" : "#E2E8F0"}; }
  .dot.active { background: ${artUri || isCta ? "#ffffff" : `#${accent}`}; }
</style></head>
<body>
  <div class="screen">
    ${background}
    <div class="texture"></div>
    <div class="scrim"></div>
    <div class="topbar"></div>
    <div class="kicker-wrap"><div class="kicker"><span class="dot-mark"></span>${escapeHtml(kickerLabel)}</div></div>
    <div class="telop-wrap">
      <div class="telop-bar">
        <div class="telop-text">${escapeHtml(scene.text).replace(/\n/g, "<br/>")}</div>
        ${noteRow}
      </div>
    </div>
    <div class="footer">${dots}</div>
  </div>
</body></html>`;
}

async function renderTeaserImages(scenes, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const vertical = options.vertical !== false;
  const dims = vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

  const artDataUris = (options.artPaths || []).map((p) => fileToDataUri(p));

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
      const html = sceneHtml(scenes[i], i, scenes.length, dims, { ...options, artDataUris });
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
