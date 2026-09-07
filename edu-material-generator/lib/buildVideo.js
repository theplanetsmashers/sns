// lib/buildVideo.js
// スライド画像+ナレーション音声のペアを、ffmpegでスライドごとの動画クリップにしてから1本に結合する。

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

async function buildSegment(imagePath, audioPath, outPath) {
  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-pix_fmt", "yuv420p",
    "-shortest",
    outPath,
  ]);
}

async function concatSegments(segmentPaths, outPath, workDir) {
  const listPath = path.join(workDir, "concat-list.txt");
  const listContent = segmentPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
}

async function buildVideo(imagePaths, audioPaths, workDir, outputPath) {
  if (imagePaths.length !== audioPaths.length) {
    throw new Error("画像とナレーション音声の数が一致しません。");
  }

  const segmentsDir = path.join(workDir, "segments");
  fs.mkdirSync(segmentsDir, { recursive: true });

  const segmentPaths = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const segPath = path.join(segmentsDir, `segment-${String(i + 1).padStart(2, "0")}.mp4`);
    await buildSegment(imagePaths[i], audioPaths[i], segPath);
    segmentPaths.push(segPath);
  }

  await concatSegments(segmentPaths, outputPath, workDir);
  return outputPath;
}

module.exports = { buildVideo };
