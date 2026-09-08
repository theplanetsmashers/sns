// bot.js
// GitHub Issueを入力フォーム代わりにした教材自動生成ボット(GitHub Actionsから実行)。
// Issueにテーマを1件書くだけで、講義構成→ナレーション音声(VOICEVOX)→スライド画像→動画(mp4)まで自動生成し、
// Issueコメントと、PPTX・動画を直接添付したDiscord通知で完成を届ける(スマホだけで受け取り完結)。
// ファイルサイズが大きく添付できなかった場合のみ、ワークフロー実行のArtifactsに案内する。

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

// PPTX・動画をDiscordのメッセージに直接添付する。スマホだけで完結させるため、
// GitHub ActionsのArtifactsを開かなくてもDiscordアプリ内でそのままファイルを受け取れるようにする。
// Discordの無料枠での上限を超えるファイルは添付せず、Artifactsへの案内文だけを送る。
async function postDiscordWithFiles(text, filePaths) {
  if (!DISCORD_WEBHOOK_URL) return { posted: false, attached: [] };

  const maxBytes = Number(process.env.DISCORD_MAX_FILE_MB || 8) * 1024 * 1024;
  const attachable = filePaths.filter(
    (p) => p && fs.existsSync(p) && fs.statSync(p).size <= maxBytes
  );

  if (attachable.length === 0) {
    await postDiscord(text);
    return { posted: true, attached: [] };
  }

  try {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: text.slice(0, 1900) }));
    attachable.forEach((p, i) => {
      form.append(`files[${i}]`, new Blob([fs.readFileSync(p)]), path.basename(p));
    });
    const res = await fetch(DISCORD_WEBHOOK_URL, { method: "POST", body: form });
    if (!res.ok) {
      console.error("Discordへのファイル添付投稿に失敗しました:", res.status, await res.text());
      await postDiscord(text);
      return { posted: true, attached: [] };
    }
    return { posted: true, attached: attachable };
  } catch (err) {
    console.error("Discordへのファイル添付投稿に失敗しました:", err.message);
    await postDiscord(text);
    return { posted: true, attached: [] };
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

  const engineLabel = { voicevox: "VOICEVOXで音声を生成しました(無料)", openai: "OpenAI TTSで音声を生成しました", silence: "音声合成に失敗したため無音です(尺は原稿の文字数から自動計算)" }[result.engine];

  const parts = [
    `✅ 教材が完成しました: **${outline.title}**`,
    "",
    "**この講義で学べること**",
    ...(outline.objectives || []).map((o) => `- ${o}`),
    "",
    `**スライド構成(全${deck.length}枚)**`,
    slideTitles,
    "",
    `ナレーション: ${engineLabel}`,
    "",
    "サイズが大きくDiscordに添付できなかった場合は、ワークフロー実行の Artifacts からダウンロードしてください。" +
      (runUrl ? `\n${runUrl}` : "Actionsタブから対象の実行を開いて確認してください。"),
  ];
  const message = parts.join("\n");

  await postIssueComment(message);

  const discordMessage = `📚 教材が完成しました(#${ISSUE_NUMBER})\n\n${message}`;
  const filesToAttach = [result.pptxPath, result.videoPath].filter(Boolean);
  await postDiscordWithFiles(discordMessage, filesToAttach);

  const history = loadHistory();
  history.push({
    topic,
    title: outline.title,
    issueNumber: ISSUE_NUMBER || null,
    narrated: result.narrated,
    engine: result.engine,
    slideCount: deck.length,
    createdAt: new Date().toISOString(),
  });
  saveHistory(history);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
