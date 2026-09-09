// lib/burnCaptions.js
// ASS字幕(テロップ)をffmpegのassフィルタ(libass)で動画に焼き込む。
// ffmpegのフィルタ文字列はコロン(:)を区切り文字として使うため、絶対パスのままだと
// タイムスタンプ以外の要因でエスケープが面倒になることがある。作業ディレクトリを字幕ファイルの
// あるフォルダに移し、ファイル名だけを渡すことでこれを避けている。

const path = require("path");
const { run } = require("./ffmpegUtil");

async function burnCaptions(videoPath, assPath, outputPath) {
  const dir = path.dirname(assPath);
  const base = path.basename(assPath);
  await run(
    "ffmpeg",
    ["-y", "-i", path.resolve(videoPath), "-vf", `ass=${base}`, "-c:a", "copy", path.resolve(outputPath)],
    { cwd: dir }
  );
  return outputPath;
}

module.exports = { burnCaptions };
