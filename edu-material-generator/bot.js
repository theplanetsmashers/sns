// bot.js
// GitHub Issueを入力フォーム代わりにした教材自動生成ボット(GitHub Actionsから実行)。
// Issueにテーマを1件書くだけで、講義構成→PPTX→スライド画像→ナレーション音声→動画(mp4)まで自動生成し、
// Issueコメント+Discordで完成を通知する。生成物(PPTX/動画)はワークフロー実行のArtifactとして添付される。

const fs = require("fs");
const path = require("path");

const { generateCourse } = require("./generate-course");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_BODY = process.env.ISSUE_BODY || "";
const RUN_ID = process.env.GITHUB_RUN_ID;
const SERVER_URL = process.env.GITHUB_SERVER_URL || "https://github.com";

const HISTORY_PATH = path.join(__dirname, "state", "history.json");

function parseField(body, label) {
  const re = new RegExp(`### \\s*${label}[^\\n]*\\n+([\\s\\S]*?)(?=\\n### |$)`);
  const m = body.match(re);
  if (!m) return "";
  const val = m[1].trim();
  return val === "_No response_" ? "" : val;
}

async function postIssueComment(text) {
  if (!GITHUB_TOKEN || !REPO || !ISSUE_NUMBER) {
    console.log("(Issueコメント投稿はスキップ: 実行環境変数が不足)\n", text);
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues/${ISSUE_NUMBER}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ body: text }),
  });
  if (!res.ok) {
    console.error("Issueへのコメント投稿に失敗しました:", res.status, await res.text());
  }
}

async function postDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    });
  } catch (err) {
    console.error("Discord通知に失敗しました:", err.message);
  }
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf8");
}

function setActionOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function main() {
  const topic = parseField(ISSUE_BODY, "テーマ") || ISSUE_BODY.trim();
  const level = parseField(ISSUE_BODY, "対象者");
  const slideCount = parseField(ISSUE_BODY, "スライド枚数");
  const note = parseField(ISSUE_BODY, "追加の指示");

  if (!topic) {
    await postIssueComment(
      "テーマを読み取れませんでした。お手数ですが「テーマ」欄に講座のお題を入力して、もう一度リクエストしてください。"
    );
    return;
  }

  await postIssueComment(`🎬 教材の生成を開始しました(テーマ: ${topic})。数分かかります…`);

  let result;
  try {
    result = await generateCourse({ topic, level, slideCount, note });
  } catch (err) {
    console.error(err);
    await postIssueComment(`教材の生成に失敗しました: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  setActionOutput("outdir", result.outDir);
  setActionOutput("title", result.outline.title);

  const { outline, deck } = result;
  const slideTitles = deck.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
  const runUrl = RUN_ID ? `${SERVER_URL}/${REPO}/actions/runs/${RUN_ID}` : null;

  const parts = [
    `✅ 教材が完成しました: **${outline.title}**`,
    "",
    "**この講義で学べること**",
    ...(outline.objectives || []).map((o) => `- ${o}`),
    "",
    `**スライド構成(全${deck.length}枚)**`,
    slideTitles,
    "",
    `ナレーション: ${result.narrated ? "TTSで音声を生成しました" : "OPENAI_API_KEY未設定のため無音動画です(尺は原稿の文字数から自動計算)"}`,
    "",
    "PPTXと動画(mp4)は、このワークフロー実行の Artifacts に添付されています。" +
      (runUrl ? `\n${runUrl}` : "Actionsタブから対象の実行を開いて確認してください。"),
  ];
  const message = parts.join("\n");

  await postIssueComment(message);
  await postDiscord(`📚 教材が完成しました(#${ISSUE_NUMBER})\n\n${message}`);

  const history = loadHistory();
  history.push({
    topic,
    title: outline.title,
    issueNumber: ISSUE_NUMBER || null,
    narrated: result.narrated,
    slideCount: deck.length,
    createdAt: new Date().toISOString(),
  });
  saveHistory(history);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
