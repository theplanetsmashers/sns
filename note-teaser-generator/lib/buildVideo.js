// lib/buildVideo.js
// シーン画像+ナレーション音声のペアを、ffmpegでシーンごとの動画クリップにしてから、
// クロスフェード(xfade/acrossfade)で滑らかに繋いで1本の動画にする。
// (edu-material-generatorのlib/buildVideo.jsと同じ方式)

const fs = require("fs");
const path = require("path");
const { run, getDurationSeconds } = require("./ffmpegUtil");
const { computeSceneTimeline, TRANSITION_SECONDS } = require("./sceneTimeline");

async function buildSegment(imagePath, audioPath, outPath) {
  await run("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", imagePath,
    "-i", audioPath,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-shortest",
    outPath,
  ]);
}

async function concatWithCrossfade(segmentPaths, durations, outPath) {
  if (segmentPaths.length === 1) {
    await run("ffmpeg", ["-y", "-i", segmentPaths[0], "-c", "copy", outPath]);
    return;
  }

  const inputArgs = [];
  segmentPaths.forEach((p) => inputArgs.push("-i", p));

  const timeline = computeSceneTimeline(durations);

  let videoChain = "";
  let audioChain = "";
  let prevV = "0:v";
  let prevA = "0:a";

  for (let i = 1; i < segmentPaths.length; i++) {
    const t = Math.min(TRANSITION_SECONDS, durations[i - 1], durations[i]) / 2 || 0.1;
    const offset = timeline[i].start;
    const isLast = i === segmentPaths.length - 1;
    const outV = isLast ? "vout" : `v${i}`;
    const outA = isLast ? "aout" : `a${i}`;

    videoChain += `[${prevV}][${i}:v]xfade=transition=fade:duration=${t.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}];`;
    audioChain += `[${prevA}][${i}:a]acrossfade=d=${t.toFixed(3)}[${outA}];`;

    prevV = outV;
    prevA = outA;
  }

  const filterComplex = videoChain + audioChain;

  await run("ffmpeg", [
    "-y",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    outPath,
  ]);
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

  let durations;
  try {
    durations = [];
    for (const p of segmentPaths) durations.push(await getDurationSeconds(p));
  } catch (err) {
    console.error(`セグメントの長さ取得に失敗したため、クロスフェード無しで結合します: ${err.message}`);
    durations = null;
  }

  if (durations) {
    try {
      await concatWithCrossfade(segmentPaths, durations, outputPath);
      return outputPath;
    } catch (err) {
      console.error(`クロスフェード結合に失敗したため、単純結合にフォールバックします: ${err.message}`);
    }
  }

  const listPath = path.join(workDir, "concat-list.txt");
  const listContent = segmentPaths
    .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
    .join("\n");
  fs.writeFileSync(listPath, listContent);
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  return outputPath;
}

module.exports = { buildVideo };
