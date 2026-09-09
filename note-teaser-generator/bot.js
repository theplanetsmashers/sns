// bot.js
// GitHub Issueを入力フォーム代わりにした「note紹介動画」自動生成ボット(GitHub Actionsから実行)。
// note記事のタイトル・本文(またはGoogleドキュメントの共有リンク)を1件書くだけで、
// 台本→ナレーション音声(VOICEVOX)→シーン画像→動画(mp4)まで自動生成し、
// Issueコメントと、動画を直接添付したDiscord通知で完成を届ける(スマホだけで受け取り完結)。

const fs = require("fs");
const path = require("path");

const { generateTeaser } = require("./generate-teaser");
const { fetchDriveDocText } = require("./lib/fetchDriveDoc");

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

// 動画をDiscordのメッセージに直接添付する。スマホだけで完結させるため、
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
  const noteTitle = parseField(ISSUE_BODY, "記事タイトル");
  const docLink = parseField(ISSUE_BODY, "Googleドキュメントの共有リンク");
  const pastedText = parseField(ISSUE_BODY, "記事本文");
  const noteUrl = parseField(ISSUE_BODY, "note記事の公開URL");
  const orientation = parseField(ISSUE_BODY, "動画の向き");
  const note = parseField(ISSUE_BODY, "追加の指示");

  if (!noteTitle) {
    await postIssueComment(
      "記事タイトルを読み取れませんでした。お手数ですが「記事タイトル」欄を入力して、もう一度リクエストしてください。"
    );
    return;
  }

  let articleText = pastedText;
  let textSource = "本文欄への貼り付け";

  if (!articleText && docLink) {
    await postIssueComment("📄 Googleドキュメントの本文取得を試みています…");
    articleText = await fetchDriveDocText(docLink);
    textSource = "Googleドキュメント(共有リンク)";
  }

  if (!articleText) {
    await postIssueComment(
      "本文を取得できませんでした。Googleドキュメントのリンクを使う場合は「リンクを知っている全員が閲覧可」に共有設定を変更してから再度リクエストしてください。" +
        "それでも取得できない場合は、「記事本文」欄に記事の冒頭部分を直接貼り付けてください。"
    );
    return;
  }

  const vertical = !orientation || !orientation.includes("横");

  await postIssueComment(
    `🎬 note紹介動画の生成を開始しました(記事: ${noteTitle} / 本文取得元: ${textSource})。数分かかります…`
  );

  let result;
  try {
    result = await generateTeaser({ noteTitle, articleText, noteUrl, note, vertical });
  } catch (err) {
    console.error(err);
    await postIssueComment(`動画の生成に失敗しました: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  setActionOutput("outdir", result.outDir);
  setActionOutput("title", result.script.videoTitle);

  const { script } = result;
  const sceneLines = script.scenes.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  const runUrl = RUN_ID ? `${SERVER_URL}/${REPO}/actions/runs/${RUN_ID}` : null;

  const engineLabel = {
    voicevox: "VOICEVOXで音声を生成しました(無料)",
    openai: "OpenAI TTSで音声を生成しました",
    silence: "音声合成に失敗したため無音です(尺は原稿の文字数から自動計算)",
  }[result.engine];

  const parts = [
    `✅ 動画が完成しました: **${script.videoTitle}**`,
    "",
    `尺: 約${result.totalSeconds}秒 / 向き: ${vertical ? "縦型(Shorts想定)" : "横型"}`,
    "",
    "**シーン構成**",
    sceneLines,
    "",
    "**YouTube概要欄の案**",
    script.youtubeDescription,
    "",
    `ナレーション: ${engineLabel}`,
    "",
    "サイズが大きくDiscordに添付できなかった場合は、ワークフロー実行の Artifacts からダウンロードしてください。" +
      (runUrl ? `\n${runUrl}` : "Actionsタブから対象の実行を開いて確認してください。"),
  ];
  const message = parts.join("\n");

  await postIssueComment(message);

  const discordMessage = `🎬 note紹介動画が完成しました(#${ISSUE_NUMBER})\n\n${message}`;
  await postDiscordWithFiles(discordMessage, [result.videoPath]);

  const history = loadHistory();
  history.push({
    noteTitle,
    videoTitle: script.videoTitle,
    noteUrl: noteUrl || null,
    issueNumber: ISSUE_NUMBER || null,
    narrated: result.narrated,
    engine: result.engine,
    vertical,
    totalSeconds: result.totalSeconds,
    createdAt: new Date().toISOString(),
  });
  saveHistory(history);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
