// lib/icons.js
// 背景の「絵」用の簡易ラインアイコン集。実写・AI生成画像が使えない場合(既定・無料の状態)でも
// テキストだけの画面にならないよう、シーン内容に合わせたアイコンを大きく背景に配置する。

const ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  checklist:
    '<path d="M4 6h13M4 12h13M4 18h13"/><path d="M20 5l-1.3 1.6L18 5.7M20 11l-1.3 1.6-.7-.9M20 17l-1.3 1.6-.7-.9"/>',
  meeting:
    '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3 2.5-5 6-5s6 2 6 5"/><path d="M10 20c0-3 2.5-5 6-5s6 2 6 5"/>',
  factory:
    '<path d="M3 21V11l5 3v-3l5 3v-3l5 3v7H3z"/><path d="M6 21v-3M11 21v-3M16 21v-3"/><path d="M6 7V4M6 4h3v3"/>',
  idea: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3 11c.6.4 1 1 1 1.7V17h4v-1.3c0-.7.4-1.3 1-1.7A6 6 0 0 0 12 3z"/>',
  note: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  question:
    '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.7 2.7 0 1 1 4 2.4c-.8.5-1.3 1.1-1.3 2v.4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
  footprints:
    '<path d="M8 4c1.5 0 2 1.2 2 2.5S9.2 10 8 10s-2-1.2-2-3.5S6.5 4 8 4z"/><path d="M16 10c1.5 0 2 1.2 2 2.5S17.2 16 16 16s-2-1.2-2-3.5S14.5 10 16 10z"/><path d="M6 12c1.5 0 2 1.2 2 2.5S7.2 18 6 18s-2-1.2-2-3.5S4.5 12 6 12z"/><path d="M14 18c1.5 0 2 1.2 2 2.5S15.2 22 14 22s-2-1.2-2-3.5S12.5 18 14 18z"/>',
  people:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6"/><circle cx="17.5" cy="9" r="2.2"/><path d="M15.6 14.6c2.7.3 4.4 2.2 4.4 5"/>',
};

const ICON_KEYS = Object.keys(ICONS);

function renderIconSvg(key, { size = 96, color = "1E3A5F", strokeWidth = 1.4 } = {}) {
  const inner = ICONS[key] || ICONS.note;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

module.exports = { ICON_KEYS, renderIconSvg };
