// lib/renderSlideImages.js
// 各スライドをHTML/CSSで描画し、Puppeteerでスクリーンショットして動画用のPNG画像を作る。
// 解像度は1280x720(720p)。スマホでの視聴やDiscordへの直接添付(ファイルサイズ)を優先し、
// フルHDより一段落とした軽量設定にしている。
//
// 日本語テキストを描画するので、実行環境に日本語フォント(例: Noto Sans CJK JP)が
// 入っていないと文字化け(トーフ/□□□)になる。GitHub Actionsのワークフロー側で
// フォントをインストールしてから呼び出すこと。
//
// レイアウトは3種類(buildDeck.jsが持つslide.layoutで切り替え):
//   list     — 通常の箇条書き(左にテキスト、右にアイコンイラストの2カラム)
//   process  — 手順・ステップを横並びの矢印フローで見せる
//   callout  — 1つの重要なメッセージをアイコン付きで大きく見せる

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { colorFor, CHECK_COLOR } = require("./palette");
const { renderIconSvg } = require("./icons");

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

function visualPanelHtml(color, iconKey) {
  return `<div class="visual-panel">
    <div class="visual-ring-outer" style="background:#${color.light}"></div>
    <div class="visual-ring-inner" style="background:#ffffff;border-color:#${color.light}">
      ${renderIconSvg(iconKey, { size: 108, color: color.accent, strokeWidth: 1.5 })}
    </div>
  </div>`;
}

const STEP_ARROW_ICON =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5l7 7-7 7"/></svg>';

function processStepsHtml(bullets, color) {
  const steps = (bullets || []).slice(0, 4);
  return steps
    .map((b, i) => {
      const arrow =
        i < steps.length - 1
          ? `<div class="step-arrow" style="color:#${color.accent}">${STEP_ARROW_ICON}</div>`
          : "";
      return `<div class="step">
        <div class="step-badge" style="background:#${color.accent}">${i + 1}</div>
        <div class="step-text">${escapeHtml(b)}</div>
      </div>${arrow}`;
    })
    .join("\n");
}

function codeBlockHtml(bullets) {
  const lines = (bullets || [])
    .map((b) => `<div class="code-line"><span class="prompt">$</span>${escapeHtml(b)}</div>`)
    .join("\n");
  return `<div class="code-block"><div class="code-dots"><span></span><span></span><span></span></div>${lines}</div>`;
}

function calloutHtml(bullets, color, iconKey) {
  const text = (bullets || []).join("。");
  return `<div class="callout" style="background:#${color.accent}12;border-left-color:#${color.accent}">
    <div class="callout-icon" style="background:#${color.accent}">${renderIconSvg(iconKey, { size: 44, color: "ffffff", strokeWidth: 1.8 })}</div>
    <div class="callout-text">${escapeHtml(text)}</div>
  </div>`;
}

function slideHtml(slide, index, total, options) {
  const isTitle = slide.kind === "title";
  const isSummary = slide.kind === "summary";
  const badgeStyle = isTitle || isSummary ? "check" : "num";
  const color = colorFor(slide, index);
  const eyebrowLabel = isTitle ? "LECTURE" : isSummary ? "SUMMARY" : `POINT ${String(index).padStart(2, "0")}`;
  const creditText = options.creditText || null;
  const metaLine =
    isTitle && (options.totalSlides || options.totalMinutes)
      ? `<div class="meta">全${options.totalSlides}枚 ・ 想定時間 約${options.totalMinutes}分</div>`
      : "";

  const layout = slide.layout || "list";
  let bodyHtml;
  if (layout === "process" && (slide.bullets || []).length >= 2) {
    bodyHtml = `<div class="content content-full">
      <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrowLabel)}</div>
      <h1>${escapeHtml(slide.title)}</h1>
      <div class="steps-row">${processStepsHtml(slide.bullets, color)}</div>
    </div>`;
  } else if (layout === "callout") {
    bodyHtml = `<div class="content content-full">
      <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrowLabel)}</div>
      <h1>${escapeHtml(slide.title)}</h1>
      ${calloutHtml(slide.bullets, color, slide.icon)}
    </div>`;
  } else if (layout === "code") {
    bodyHtml = `<div class="content content-full">
      <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrowLabel)}</div>
      <h1>${escapeHtml(slide.title)}</h1>
      ${codeBlockHtml(slide.bullets)}
    </div>`;
  } else {
    const items = itemsHtml(slide.bullets, badgeStyle, color.accent);
    bodyHtml = `<div class="content-row">
      <div class="content">
        <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrowLabel)}</div>
        <h1>${escapeHtml(slide.title)}</h1>
        ${metaLine}
        <div class="items">${items}</div>
      </div>
      ${visualPanelHtml(color, slide.icon)}
    </div>`;
  }

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
  .frame {
    position: absolute; inset: 18px 18px 78px 18px;
    border: 1px solid rgba(15,23,42,0.07); border-radius: 22px;
    z-index: 0; pointer-events: none;
  }
  .content-row { position: relative; z-index: 1; flex: 1; display: flex; align-items: stretch; }
  .content { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 40px 40px 40px 88px; }
  .content-row .content { flex: 0 0 60%; padding-right: 20px; }
  .content-full { padding: 40px 88px; }
  .eyebrow {
    display: inline-flex; align-self: flex-start; align-items: center; gap: 8px;
    background: #${color.light}; color: #${color.accent}; font-weight: 700; font-size: 15px; letter-spacing: 2px;
    padding: 7px 16px; border-radius: 999px; margin-bottom: 22px;
  }
  .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: #${color.accent}; }
  h1 { font-weight: 700; color: #1F2937; line-height: 1.35; letter-spacing: 0.3px; margin-bottom: 14px; }
  .content h1 { font-size: 32px; }
  .title-slide h1 { font-size: 46px; }
  .meta { font-size: 16px; color: #6B7280; margin-bottom: 26px; }
  .items { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; }
  .item {
    display: flex; align-items: flex-start; gap: 16px;
    border-radius: 12px; border-left: 4px solid transparent;
    padding: 13px 18px;
  }
  .badge {
    flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 700; color: #ffffff;
    box-shadow: 0 3px 6px rgba(15, 23, 42, 0.22);
  }
  .item .text { font-size: 21px; line-height: 1.55; color: #1F2937; padding-top: 3px; }

  .visual-panel {
    flex: 0 0 40%; position: relative; display: flex; align-items: center; justify-content: center;
  }
  .visual-ring-outer { position: absolute; width: 260px; height: 260px; border-radius: 50%; }
  .visual-ring-inner {
    position: relative; width: 180px; height: 180px; border-radius: 50%; border: 1px solid;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
  }

  .steps-row { display: flex; align-items: flex-start; margin-top: 40px; gap: 6px; }
  .step { display: flex; flex-direction: column; align-items: center; width: 220px; text-align: center; }
  .step-badge {
    width: 52px; height: 52px; border-radius: 50%; color: #fff; font-size: 20px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
    box-shadow: 0 6px 14px rgba(15, 23, 42, 0.22);
  }
  .step-text { font-size: 19px; line-height: 1.5; color: #1F2937; }
  .step-arrow { display: flex; align-items: center; padding-top: 12px; flex: 0 0 auto; }

  .callout {
    display: flex; align-items: center; gap: 28px;
    border-radius: 16px; border-left: 6px solid; padding: 34px 40px; margin-top: 20px;
  }
  .callout-icon {
    flex: 0 0 auto; width: 84px; height: 84px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.2);
  }
  .callout-text { font-size: 27px; line-height: 1.6; font-weight: 700; color: #1F2937; }

  .code-block {
    background: #1E293B; border-radius: 14px; padding: 24px 28px; margin-top: 24px;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.22);
  }
  .code-dots { display: flex; gap: 7px; margin-bottom: 16px; }
  .code-dots span { width: 11px; height: 11px; border-radius: 50%; background: #475569; display: inline-block; }
  .code-line {
    font-family: "SFMono-Regular", "Consolas", "Menlo", monospace, ${FONT_STACK};
    font-size: 19px; line-height: 1.9; color: #E2E8F0;
  }
  .code-line .prompt { color: #34D399; margin-right: 12px; font-weight: 700; }

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
    <div class="frame"></div>
    ${bodyHtml}
    <div class="footer">
      <div class="credit">${creditText ? escapeHtml(creditText) : ""}</div>
      <div class="right">
        <div class="progress">${Array.from({ length: total }, (_, i) => `<div class="seg" style="${i === index ? `background:#${color.accent}` : ""}"></div>`).join("")}</div>
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
