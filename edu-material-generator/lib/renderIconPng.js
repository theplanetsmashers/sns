// lib/renderIconPng.js
// PPTXにはSVGを直接埋め込めないので、必要なアイコンだけをPuppeteerで透過PNGにラスタライズする。
// 動画スライド(renderSlideImages.js)側はHTML内に直接SVGを埋め込んでいるので、これはPPTX専用。

const puppeteer = require("puppeteer");
const { renderIconSvg } = require("./icons");

function cacheKeyFor(key, color, size) {
  return `${key}__${color}__${size}`;
}

// requests: [{ key, color, size }] を受け取り、{ cacheKey: pngBuffer } を返す。
async function renderIconPngs(requests) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results = {};
  try {
    const page = await browser.newPage();
    for (const { key, color, size = 240 } of requests) {
      const cacheKey = cacheKeyFor(key, color, size);
      if (results[cacheKey]) continue;
      const svg = renderIconSvg(key, { size, color, strokeWidth: 1.4 });
      await page.setViewport({ width: size, height: size });
      await page.setContent(
        `<html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;">${svg}</body></html>`,
        { waitUntil: "load" }
      );
      results[cacheKey] = await page.screenshot({ type: "png", omitBackground: true });
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { renderIconPngs, cacheKeyFor };
