// lib/interview-engine.js
// interview.js (CLI) と slack-bot/server.js (Slack) から共有される対話エンジンの中核部分。
// 「テンプレート読み込み」「Claude呼び出し」「回答分析(深掘り判定・要約・濃さ評価)」を
// 1箇所にまとめ、フロントエンド(CLI/Slack/将来のWeb)ごとの重複を避ける。

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const TEMPLATES_DIR = path.join(ROOT_DIR, "templates");
const SESSIONS_DIR = path.join(ROOT_DIR, "sessions");
const DEFAULT_TEMPLATE = "manufacturing-supervisor";
const CLAUDE_MODEL = "claude-sonnet-4-6";

function listTemplateNames() {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadTemplate(name) {
  const filePath = path.join(TEMPLATES_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `テンプレート "${name}" が見つかりません。利用可能: ${listTemplateNames().join(", ")}`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveTemplate(name, questions) {
  if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  const filePath = path.join(TEMPLATES_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(questions, null, 2), "utf-8");
  return filePath;
}

function slugify(text) {
  return (
    String(text)
      .trim()
      .replace(/[^\w぀-ヿ一-鿿]+/g, "_")
      .slice(0, 30) || "session"
  );
}

async function callClaude(prompt, maxTokens = 1000, apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  return textBlock ? textBlock.text.trim() : "";
}

function stripJsonFence(raw) {
  return raw.replace(/```json|```/g, "").trim();
}

// 回答を評価し、深掘りの要否・要約・暗黙知の濃さ(richness_score)をJSONで返してもらう
async function analyzeAnswer(category, question, answer) {
  const prompt = `あなたは製造業のベテラン技能者から暗黙知を引き出すインタビュアーです。
以下の質問と回答を読み、次の3つを判断してください。

【質問カテゴリ】${category}
【質問】${question}
【回答】${answer}

1. この回答は、他人がマニュアル化・再現できるほど具体的か?抽象的すぎたり一般論に留まっている場合は、深掘りの追加質問を1つ考えてください。
2. 回答から読み取れる暗黙知のポイントを2〜4行で要約してください(判断基準・感覚的な手がかり・失敗の芽など、マニュアルに落とし込める要素を優先すること)。
3. この回答の「暗黙知の濃さ」を1〜5の整数で評価してください(1=一般論・表面的、5=他人が再現できるレベルまで具体的)。

出力は必ず以下のJSON形式のみ。前置きや説明、コードブロック記号は不要です。
{"needs_followup": true か false, "followup_question": "深掘りが不要なら空文字列", "summary": "要約テキスト", "richness_score": 1から5の整数}`;

  const raw = await callClaude(prompt, 600);
  try {
    const parsed = JSON.parse(stripJsonFence(raw));
    if (typeof parsed.richness_score !== "number") parsed.richness_score = 3;
    return parsed;
  } catch (e) {
    // パース失敗時はフォールバック(深掘りなしで生の回答を要約扱いにする)
    return { needs_followup: false, followup_question: "", summary: answer, richness_score: 3 };
  }
}

function saveSession(sessionPath, session) {
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
}

function newSessionPath(topic) {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(SESSIONS_DIR, `${timestamp}_${slugify(topic)}.json`);
}

module.exports = {
  ROOT_DIR,
  TEMPLATES_DIR,
  SESSIONS_DIR,
  DEFAULT_TEMPLATE,
  listTemplateNames,
  loadTemplate,
  saveTemplate,
  slugify,
  callClaude,
  stripJsonFence,
  analyzeAnswer,
  saveSession,
  newSessionPath,
};
