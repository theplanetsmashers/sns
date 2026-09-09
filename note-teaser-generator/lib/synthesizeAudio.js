// lib/synthesizeAudio.js
// シーンごとのナレーション原稿を音声にする(edu-material-generatorと同じ方式)。
// 優先順位: 1) VOICEVOX(無料・APIキー不要。GitHub Actions上でDockerコンテナとして起動する)
//           2) OpenAI TTS(OPENAI_API_KEYを設定した場合のみ。有料なので任意)
//           3) 無音(原稿の文字数から尺だけ見積もった無音音声。動画自体は必ず完成させるための最終手段)

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function estimateDurationSeconds(text) {
  const chars = String(text || "").length;
  const seconds = chars / 6; // 日本語の読み上げ速度の目安(6文字/秒程度)
  return Math.max(seconds, 1.5);
}

async function synthesizeVoicevox(text, outPath, speaker) {
  const baseUrl = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";

  const queryRes = await fetch(
    `${baseUrl}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`,
    { method: "POST" }
  );
  if (!queryRes.ok) {
    throw new Error(`VOICEVOX audio_query error: ${queryRes.status} ${await queryRes.text()}`);
  }
  const query = await queryRes.json();

  const synthRes = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthRes.ok) {
    throw new Error(`VOICEVOX synthesis error: ${synthRes.status}`);
  }

  const buf = Buffer.from(await synthRes.arrayBuffer());
  fs.writeFileSync(outPath, buf);
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
      response_format: "wav",
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
      ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(durationSeconds), outPath],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function synthesizeAudio(scenes, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const speaker = process.env.VOICEVOX_SPEAKER_ID || "3"; // 3 = ずんだもん(ノーマル)
  const hasOpenAi = !!process.env.OPENAI_API_KEY;

  const audioPaths = [];
  let usedVoicevox = false;
  let usedOpenAi = false;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const outPath = path.join(outDir, `narration-${String(i + 1).padStart(2, "0")}.wav`);
    const text = (scene.narration && scene.narration.trim()) || scene.text;
    let done = false;

    try {
      await synthesizeVoicevox(text, outPath, speaker);
      usedVoicevox = true;
      done = true;
    } catch (err) {
      console.error(`VOICEVOXでの音声生成に失敗しました(シーン${i + 1}): ${err.message}`);
    }

    if (!done && hasOpenAi) {
      try {
        await synthesizeOpenAiTts(text, outPath);
        usedOpenAi = true;
        done = true;
      } catch (err) {
        console.error(`OpenAI TTSでの音声生成にも失敗しました(シーン${i + 1}): ${err.message}`);
      }
    }

    if (!done) {
      await generateSilence(estimateDurationSeconds(text), outPath);
    }
    audioPaths.push(outPath);
  }

  const engine = usedVoicevox ? "voicevox" : usedOpenAi ? "openai" : "silence";
  return { audioPaths, narrated: usedVoicevox || usedOpenAi, engine };
}

module.exports = { synthesizeAudio, estimateDurationSeconds };
