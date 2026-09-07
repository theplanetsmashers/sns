// lib/synthesizeAudio.js
// スライドごとのナレーション原稿を音声(mp3)にする。
// OPENAI_API_KEY があればOpenAIのTTSで実際に読み上げ、なければ
// 原稿の文字数から尺を見積もった無音音声を代わりに作る(動画自体は無音でも生成できるようにするため)。

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function estimateDurationSeconds(text) {
  const chars = String(text || "").length;
  const seconds = chars / 6; // 日本語の読み上げ速度の目安(6文字/秒程度)
  return Math.max(seconds, 2);
}

async function synthesizeOpenAiTts(text, outPath) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI TTS error: ${res.status} ${errText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

function generateSilence(durationSeconds, outPath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=mono",
        "-t", String(durationSeconds),
        "-q:a", "9",
        outPath,
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function synthesizeAudio(deck, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const hasOpenAi = !!process.env.OPENAI_API_KEY;
  const audioPaths = [];

  for (let i = 0; i < deck.length; i++) {
    const slide = deck[i];
    const outPath = path.join(outDir, `narration-${String(i + 1).padStart(2, "0")}.mp3`);
    const text = (slide.narration && slide.narration.trim()) || slide.title;

    if (hasOpenAi) {
      try {
        await synthesizeOpenAiTts(text, outPath);
      } catch (err) {
        console.error(`TTS生成に失敗したためスライド${i + 1}は無音で代替します: ${err.message}`);
        await generateSilence(estimateDurationSeconds(text), outPath);
      }
    } else {
      await generateSilence(estimateDurationSeconds(text), outPath);
    }
    audioPaths.push(outPath);
  }

  return { audioPaths, narrated: hasOpenAi };
}

module.exports = { synthesizeAudio, estimateDurationSeconds };
