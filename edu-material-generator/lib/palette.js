// lib/palette.js
// 動画スライド(renderSlideImages.js)とPPTX(buildPptx.js)で共通のアクセントカラー。
// コンテンツスライドごとに色をローテーションして、全スライドが同じ配色にならないようにする
// (タイトル/まとめは常に先頭色でブックエンドにする)。色コードは"#"無しのhexで統一し、
// CSSで使う側が"#"を付ける。

const PALETTE = [
  { accent: "2563EB", light: "EEF2FF" }, // blue
  { accent: "0D9488", light: "ECFDF5" }, // teal
  { accent: "7C3AED", light: "F3E8FF" }, // purple
  { accent: "DB2777", light: "FDF2F8" }, // rose
];

const CHECK_COLOR = "059669"; // objectives/summaryのチェックバッジは常にこの緑で統一(意味を固定する)

function colorFor(slide, index) {
  if (slide.kind === "content") {
    return PALETTE[(index - 1) % PALETTE.length];
  }
  return PALETTE[0];
}

module.exports = { PALETTE, CHECK_COLOR, colorFor };
