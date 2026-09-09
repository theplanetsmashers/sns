// lib/buildCaptions.js
// scene.text(画面表示用の短いキャプション)を、そのシーンのナレーション音声の長さに合わせて
// 「今話している文字だけ色が変わる」動くテロップ(ASS字幕)にする。
// TikTok/Shorts系でよく見る、1文字(1単語)ずつハイライトが移動していくキャプションの見た目にする。
// ffmpegのassフィルタ(libass)で動画に焼き込むための.assファイルを作る。

const fs = require("fs");
const { computeSceneTimeline, TRANSITION_SECONDS } = require("./sceneTimeline");

const HIGHLIGHT_COLOR = "1673F9"; // ASSはBGR順の16進数(F97316 = ブランドのオレンジ)

function formatAssTime(seconds) {
  const s = Math.max(seconds, 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${sec.toFixed(2).padStart(5, "0")}`;
}

function escapeAssText(str) {
  return String(str).replace(/[{}]/g, "").replace(/\n/g, "\\N");
}

// 1シーンぶんのキャプションを、文字ごとに「その文字だけハイライトされる」イベントの列にする。
// 常に全文を表示し続け、話している位置の文字だけ色が変わって進んでいく見た目になる。
function buildSceneEvents(text, sceneStart, sceneEnd) {
  const chars = Array.from(text);
  if (chars.length === 0) return [];

  const duration = Math.max(sceneEnd - sceneStart, 0.3);
  const perChar = duration / chars.length;

  return chars.map((_, i) => {
    const start = sceneStart + perChar * i;
    const end = i === chars.length - 1 ? sceneEnd : sceneStart + perChar * (i + 1);
    const before = escapeAssText(chars.slice(0, i).join(""));
    const active = escapeAssText(chars[i]);
    const after = escapeAssText(chars.slice(i + 1).join(""));
    const line = `${before}{\\c&H${HIGHLIGHT_COLOR}&}${active}{\\c}${after}`;
    return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Telop,,0,0,0,,${line}`;
  });
}

function buildAss(scenes, durations, dims) {
  const timeline = computeSceneTimeline(durations, TRANSITION_SECONDS);
  const fontSize = Math.round(dims.width * 0.072);
  const marginV = Math.round(dims.height * 0.17);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${dims.width}
PlayResY: ${dims.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Telop,Noto Sans CJK JP,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,6,3,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = scenes
    .flatMap((scene, i) => buildSceneEvents(scene.text, timeline[i].start, timeline[i].end))
    .join("\n");

  return `${header}${events}\n`;
}

function writeCaptionsFile(scenes, durations, dims, outPath) {
  const content = buildAss(scenes, durations, dims);
  fs.writeFileSync(outPath, content, "utf8");
  return outPath;
}

module.exports = { writeCaptionsFile };
