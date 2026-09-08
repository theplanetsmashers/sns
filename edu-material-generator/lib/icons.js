// lib/icons.js
// スライドに「見てイメージできる」要素を持たせるための、内容に応じて選ばれるフラットなライン
// アイコンのライブラリ。写実的な画像生成AIは使わず(未設定)、意味のわかりやすいアイコンを
// スライドの内容に合わせてClaudeに選んでもらい、視覚的な手がかりとして表示する。
//
// 各アイコンは24x24のviewBoxで、stroke="currentColor"のライン画。呼び出し側の色指定で
// 自由に着色できる(セクションごとのアクセントカラーと連動させるため)。

const ICONS = {
  idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-6 6c0 2.5 1.5 3.8 2.2 4.9.5.8.8 1.6.8 2.1h6c0-.5.3-1.3.8-2.1.7-1.1 2.2-2.4 2.2-4.9a6 6 0 0 0-6-6Z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  chart: '<rect x="4" y="12" width="3.2" height="8"/><rect x="10.4" y="7" width="3.2" height="13"/><rect x="16.8" y="3" width="3.2" height="17"/>',
  team: '<circle cx="8" cy="8" r="3"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.6"/><path d="M14.8 20c0-2.8 2-5 4.7-5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.2"/><path d="M12 3.3v2M12 18.7v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3.3 12h2M18.7 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  checklist: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="M8 12l2 2 4-4M8 17l2 2 4-4"/>',
  warning: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5M12 18h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  money: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5V4.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  cycle: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  rocket: '<path d="M12 2c3 2 5 6 5 10 0 2-1 4-2 5l-1-3-2 2-2-2-1 3c-1-1-2-3-2-5 0-4 2-8 5-10Z"/><circle cx="12" cy="10" r="1.4"/><path d="M9 17l-2 4M15 17l2 4"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3Z"/><path d="M9 12l2 2 4-4"/>',
  chat: '<path d="M4 5h16v11H8l-4 4V5Z"/><path d="M8 9h8M8 12h5"/>',
  funnel: '<path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z"/>',
  scale: '<path d="M12 2v18M6 6l-4 7a4 4 0 0 0 8 0L6 6ZM18 6l-4 7a4 4 0 0 0 8 0L18 6ZM7 6h10M8 20h8"/>',
  flag: '<path d="M5 3v18"/><path d="M5 4h13l-3 4 3 4H5Z"/>',
  factory: '<path d="M3 21V11l5 3v-3l5 3v-3l5 3v7H3Z"/><path d="M7 21v-4M12 21v-4M17 21v-4"/>',
  truck: '<rect x="2" y="8" width="12" height="8"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="6" cy="18" r="1.6" fill="currentColor"/><circle cx="17" cy="18" r="1.6" fill="currentColor"/>',
  box: '<path d="M3 8l9-5 9 5-9 5-9-5Z"/><path d="M3 8v9l9 5 9-5V8"/><path d="M12 13v9"/>',
  flow: '<path d="M3 12h4M5 9l2 3-2 3M11 12h4M13 9l2 3-2 3M19 12h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  document: '<path d="M6 2h9l5 5v15H6Z"/><path d="M15 2v5h5"/><path d="M9 13h6M9 17h6"/>',
};

const ICON_KEYS = Object.keys(ICONS);

function renderIconSvg(key, { size = 96, color = "2563EB", strokeWidth = 1.6 } = {}) {
  const inner = ICONS[key] || ICONS.idea;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

module.exports = { ICONS, ICON_KEYS, renderIconSvg };
