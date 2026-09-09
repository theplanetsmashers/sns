// lib/generateBgm.js
// 「聴き心地の良いBGM」を、追加の音源ファイルなしでffmpegの音声合成だけからその場で作る。
// 外部音源を使わないので著作権の心配がなく、ネットワーク接続なしのGitHub Actions環境でも常に生成できる。
//
// 柔らかい和音(G3/B3/D4/G4)を4本のサイン波として重ね、ゆっくりしたトレモロとローパスフィルタで
// 電子音の硬さを削り、ナレーションの邪魔にならない静かなアンビエントパッドにする。

const { run } = require("./ffmpegUtil");

const CHORD_HZ = [196.0, 246.94, 293.66, 392.0]; // G3, B3, D4, G4(柔らかいメジャー系の和音)

async function generateBgm(durationSeconds, outPath) {
  const dur = Math.max(durationSeconds, 2);
  const fadeStart = Math.max(dur - 2.5, 0);

  const inputArgs = CHORD_HZ.flatMap((freq) => [
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=${dur.toFixed(2)}`,
  ]);

  const perNoteFilters = CHORD_HZ.map(
    (_, i) => `[${i}:a]tremolo=f=0.12:d=0.35,volume=0.22[n${i}]`
  ).join(";");
  const mixInputs = CHORD_HZ.map((_, i) => `[n${i}]`).join("");

  const filterComplex =
    `${perNoteFilters};` +
    `${mixInputs}amix=inputs=${CHORD_HZ.length}:duration=longest:normalize=0[mixed];` +
    `[mixed]lowpass=f=1800,afade=t=in:st=0:d=2,afade=t=out:st=${fadeStart.toFixed(2)}:d=2.5[out]`;

  await run("ffmpeg", [
    "-y",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-c:a", "aac",
    "-b:a", "128k",
    outPath,
  ]);

  return outPath;
}

module.exports = { generateBgm };
