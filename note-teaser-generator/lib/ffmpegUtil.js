// lib/ffmpegUtil.js
// ffmpeg/ffprobeをコマンドとして呼び出す共通ヘルパー。buildVideo.js・generateBgm.js・mixBgm.jsで共用する。

const { execFile } = require("child_process");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

async function getDurationSeconds(filePath) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);
  const seconds = parseFloat(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`動画/音声の長さを取得できませんでした: ${filePath}`);
  }
  return seconds;
}

module.exports = { run, getDurationSeconds };
