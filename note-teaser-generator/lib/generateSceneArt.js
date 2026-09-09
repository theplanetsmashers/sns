// lib/generateSceneArt.js
// OPENAI_API_KEYが設定されている場合のみ、シーンごとの背景イラストをOpenAI Images APIで生成する
// (テキストだけの画面ではなく、画像の上にテロップを載せた「動画らしい」見た目にするための素材)。
// APIキー未設定・生成失敗時はnullを返し、呼び出し側はアイコン+グラデーションの装飾背景に
// フォールバックする(こちらが既定・無料の状態)。

const fs = require("fs");
const path = require("path");

const STYLE_GUIDE =
  "Photorealistic documentary-style photograph, candid moment, natural available light, " +
  "shallow depth of field, 35mm film photography look, Japanese office/factory setting, " +
  "muted navy and warm orange color grading, no text, no letters, no numbers, no logos, no watermark, " +
  "no illustration, no cartoon, no 3D render";

async function generateOne(prompt, size, apiKey) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1 }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI Images API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("画像データ(b64_json)が応答に含まれていませんでした。");
  return Buffer.from(b64, "base64");
}

async function generateSceneArt(scenes, outDir, { width = 1080, height = 1920 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return scenes.map(() => null);

  fs.mkdirSync(outDir, { recursive: true });
  const size = width >= height ? "1536x1024" : "1024x1536";

  const paths = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const prompt = `${scene.imagePrompt || scene.text}. ${STYLE_GUIDE}`;
    try {
      const buf = await generateOne(prompt, size, apiKey);
      const outPath = path.join(outDir, `art-${String(i + 1).padStart(2, "0")}.png`);
      fs.writeFileSync(outPath, buf);
      paths.push(outPath);
    } catch (err) {
      console.error(
        `シーン${i + 1}の背景イラスト生成に失敗しました(装飾背景にフォールバックします): ${err.message}`
      );
      paths.push(null);
    }
  }
  return paths;
}

module.exports = { generateSceneArt };
