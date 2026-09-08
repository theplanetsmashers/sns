// generate-course.js
// テーマ名から「講義構成 → PPTX → スライド画像 → ナレーション音声 → 動画(mp4)」までを一気通貫で作るメイン処理。
// CLIから直接叩く(npm run generate -- "テーマ名")ことも、bot.js(GitHub Issue経由)から呼ぶこともできる。

const fs = require("fs");
const path = require("path");

const { generateOutline } = require("./lib/generateOutline");
const { buildDeck } = require("./lib/buildDeck");
const { buildPptx } = require("./lib/buildPptx");
const { renderSlideImages } = require("./lib/renderSlideImages");
const { synthesizeAudio, estimateDurationSeconds } = require("./lib/synthesizeAudio");
const { buildVideo } = require("./lib/buildVideo");

function slugify(text) {
  return String(text)
    .trim()
    .slice(0, 40)
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "") || "course";
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function generateCourse({ topic, level, slideCount, language, note, skipVideo = false }) {
  if (!topic || !topic.trim()) {
    throw new Error("テーマ(topic)が指定されていません。");
  }

  console.log(`[1/5] 講義構成を生成中: ${topic}`);
  const outline = await generateOutline({ topic, level, slideCount, language, note });
  const deck = buildDeck(outline);

  const dirName = `${timestamp()}_${slugify(outline.title)}`;
  const outDir = path.join(__dirname, "output", dirName);
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "outline.json"), JSON.stringify(outline, null, 2), "utf8");

  const scriptText = deck
    .map((s, i) => `--- スライド${i + 1}: ${s.title} ---\n${s.narration}\n`)
    .join("\n");
  fs.writeFileSync(path.join(outDir, "script.txt"), scriptText, "utf8");

  const totalMinutes = Math.max(
    1,
    Math.round(deck.reduce((sum, s) => sum + estimateDurationSeconds(s.narration), 0) / 60)
  );

  console.log("[2/5] PPTXを生成中...");
  const pptxPath = path.join(outDir, "course.pptx");
  await buildPptx(outline, deck, pptxPath, { totalSlides: deck.length, totalMinutes });

  let videoPath = null;
  let narrated = false;
  let engine = "silence";

  if (!skipVideo) {
    console.log("[3/5] ナレーション音声を生成中(VOICEVOX優先)...");
    const audioDir = path.join(outDir, "audio");
    const audioResult = await synthesizeAudio(deck, audioDir);
    narrated = audioResult.narrated;
    engine = audioResult.engine;

    console.log("[4/5] スライド画像を生成中...");
    const imagesDir = path.join(outDir, "images");
    const creditText = engine === "voicevox" ? "音声: VOICEVOX" : null;
    const imagePaths = await renderSlideImages(deck, imagesDir, {
      creditText,
      totalSlides: deck.length,
      totalMinutes,
    });

    console.log("[5/5] 動画を組み立て中(ffmpeg)...");
    videoPath = path.join(outDir, "course.mp4");
    await buildVideo(imagePaths, audioResult.audioPaths, outDir, videoPath);
  }

  return { outline, deck, outDir, pptxPath, videoPath, narrated, engine };
}

async function main() {
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    console.error('使い方: node generate-course.js "テーマ名"');
    process.exitCode = 1;
    return;
  }
  const result = await generateCourse({ topic });
  console.log("\n完了しました:");
  console.log(`  出力先: ${result.outDir}`);
  console.log(`  PPTX: ${result.pptxPath}`);
  if (result.videoPath) {
    const engineLabel = { voicevox: "VOICEVOX(無料)", openai: "OpenAI TTS", silence: "無音" }[result.engine];
    console.log(`  動画: ${result.videoPath} (ナレーション: ${engineLabel})`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { generateCourse };
