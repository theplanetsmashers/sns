// generate-teaser.js
// note記事の本文から「台本 → ナレーション音声 → シーン画像 → 動画(mp4)」までを
// 一気通貫で作るメイン処理。CLIから直接叩くことも、bot.js(GitHub Issue経由)から呼ぶこともできる。

const fs = require("fs");
const path = require("path");

const { generateScript } = require("./lib/generateScript");
const { synthesizeAudio, estimateDurationSeconds } = require("./lib/synthesizeAudio");
const { generateSceneArt } = require("./lib/generateSceneArt");
const { renderTeaserImages } = require("./lib/renderTeaserImages");
const { buildVideo } = require("./lib/buildVideo");
const { generateBgm } = require("./lib/generateBgm");
const { mixBgm } = require("./lib/mixBgm");
const { getDurationSeconds } = require("./lib/ffmpegUtil");

const DIMS = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1920, height: 1080 },
};

function slugify(text) {
  return (
    String(text)
      .trim()
      .slice(0, 40)
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "") || "teaser"
  );
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function generateTeaser({ noteTitle, articleText, noteUrl, note, vertical = true }) {
  if (!noteTitle || !noteTitle.trim()) {
    throw new Error("note記事のタイトル(noteTitle)が指定されていません。");
  }
  if (!articleText || !articleText.trim()) {
    throw new Error("note記事の本文(articleText)が指定されていません。");
  }

  console.log(`[1/4] 台本を生成中: ${noteTitle}`);
  const script = await generateScript({ noteTitle, articleText, noteUrl, note });

  const dirName = `${timestamp()}_${slugify(script.videoTitle || noteTitle)}`;
  const outDir = path.join(__dirname, "output", dirName);
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "script.json"), JSON.stringify(script, null, 2), "utf8");

  const scriptText = script.scenes
    .map((s, i) => `--- シーン${i + 1} ---\n表示: ${s.text}\nナレーション: ${s.narration}\n`)
    .join("\n");
  fs.writeFileSync(path.join(outDir, "script.txt"), scriptText, "utf8");

  const totalSeconds = Math.round(
    script.scenes.reduce((sum, s) => sum + estimateDurationSeconds(s.narration), 0)
  );

  console.log("[2/6] ナレーション音声を生成中(VOICEVOX優先)...");
  const audioDir = path.join(outDir, "audio");
  const audioResult = await synthesizeAudio(script.scenes, audioDir);

  console.log("[3/6] 背景イラストを生成中(OPENAI_API_KEY設定時のみ。未設定ならアイコン装飾にフォールバック)...");
  const artDir = path.join(outDir, "art");
  const dims = vertical ? DIMS.vertical : DIMS.horizontal;
  const artPaths = await generateSceneArt(script.scenes, artDir, dims);

  console.log("[4/6] シーン画像を生成中...");
  const imagesDir = path.join(outDir, "images");
  const imagePaths = await renderTeaserImages(script.scenes, imagesDir, { vertical, noteTitle, artPaths });

  console.log("[5/6] 動画を組み立て中(ffmpeg)...");
  const narratedPath = path.join(outDir, "teaser-narration.mp4");
  await buildVideo(imagePaths, audioResult.audioPaths, outDir, narratedPath);

  console.log("[6/6] BGMを合成中...");
  const narratedDuration = await getDurationSeconds(narratedPath);
  const bgmPath = path.join(outDir, "bgm.m4a");
  await generateBgm(narratedDuration + 1, bgmPath);
  const bgmVolume = audioResult.engine === "silence" ? 0.32 : 0.14;
  const videoPath = path.join(outDir, "teaser.mp4");
  await mixBgm(narratedPath, bgmPath, videoPath, bgmVolume);

  return {
    script,
    outDir,
    videoPath,
    narrated: audioResult.narrated,
    engine: audioResult.engine,
    usedAiArt: artPaths.some(Boolean),
    totalSeconds,
  };
}

async function main() {
  const noteTitle = process.argv[2];
  const articleText = process.argv[3];
  if (!noteTitle || !articleText) {
    console.error('使い方: node generate-teaser.js "記事タイトル" "記事本文" [note記事URL]');
    process.exitCode = 1;
    return;
  }
  const noteUrl = process.argv[4];
  const result = await generateTeaser({ noteTitle, articleText, noteUrl });
  console.log("\n完了しました:");
  console.log(`  出力先: ${result.outDir}`);
  const engineLabel = { voicevox: "VOICEVOX(無料)", openai: "OpenAI TTS", silence: "無音" }[result.engine];
  console.log(`  動画: ${result.videoPath} (約${result.totalSeconds}秒 / ナレーション: ${engineLabel})`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { generateTeaser };
