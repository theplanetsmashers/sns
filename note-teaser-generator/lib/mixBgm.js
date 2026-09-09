// lib/mixBgm.js
// 完成した動画(ナレーション音声入り)に、BGMをミックスして重ねる。
// ナレーションがある場合はBGMを小さめに(邪魔をしない程度)、無音フォールバックの場合は
// BGMだけが頼りになるので少し大きめにする。

const { run } = require("./ffmpegUtil");

async function mixBgm(videoPath, bgmPath, outputPath, bgmVolume) {
  await run("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", bgmPath,
    "-filter_complex",
    `[1:a]volume=${bgmVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "128k",
    outputPath,
  ]);
  return outputPath;
}

module.exports = { mixBgm };
