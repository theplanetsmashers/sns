// bot.js
// GitHub Issueを入力フォーム代わりにしたコメント案生成ボット(GitHub Actionsから実行)。
// スマホからIssueを1件作るだけで、投稿URL(または本文)→コメント案生成→Issueコメント+Discord通知、
// までを自動化する。実際の投稿は必ず人間が手動で行う。

const { generateComments } = require("./lib/generate");
const { loadHistory, saveHistory } = require("./lib/history");
const { fetchOgMetadata } = require("./lib/fetchPost");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_BODY = process.env.ISSUE_BODY || "";

// GitHubのIssueフォームは "### ラベル\n\n値" という形式でbodyを生成する。
// フォームを使わず生issueで送られた場合はこの形式に一致しないので、
// 何も抽出できなければbody全体をURL/本文として扱うフォールバックを後段で行う。
function parseField(body, label) {
  // 見出しが"label"で始まる場合のみマッチさせる。単に[^\n]*で囲むと、
  // 別フィールドの説明文中にlabelと同じ文字列が含まれていた場合に誤爆するため。
  const re = new RegExp(`### \\s*${label}[^\\n]*\\n+([\\s\\S]*?)(?=\\n### |$)`);
  const m = body.match(re);
  if (!m) return "";
  const val = m[1].trim();
  return val === "_No response_" ? "" : val;
}

async function postIssueComment(text) {
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

async function main() {
  let author = parseField(ISSUE_BODY, "投稿者");
  let url = parseField(ISSUE_BODY, "投稿URL") || parseField(ISSUE_BODY, "URL");
  let postText = parseField(ISSUE_BODY, "投稿本文") || parseField(ISSUE_BODY, "本文");
  const note = parseField(ISSUE_BODY, "追加の指示");

  // テンプレートを使わず生issueで送られた場合のフォールバック:
  // 本文全体がURLならURLとして、そうでなければ本文としてそのまま扱う。
  if (!author && !url && !postText) {
    const trimmedBody = ISSUE_BODY.trim();
    if (/^https?:\/\/\S+$/.test(trimmedBody)) {
      url = trimmedBody;
    } else if (trimmedBody) {
      postText = trimmedBody;
    }
  }

  let fetchNote = "";
  if (!postText && url) {
    const meta = await fetchOgMetadata(url);
    if (meta && meta.description) {
      postText = meta.description;
      fetchNote = "(URLから自動取得した本文です。実際の投稿と異なる場合があります)\n";
      if (!author && meta.title) {
        const m = meta.title.match(/^(.*?)\s*[\((]@/);
        if (m) author = m[1].trim();
      }
    }
  }

  if (!postText) {
    await postIssueComment(
      "投稿本文を取得できませんでした。URLからの自動取得に失敗した可能性があります。" +
        "お手数ですが、このIssueに投稿本文をそのまま貼り付けてコメントするか、" +
        "新しいIssueの「投稿本文」欄に直接貼り付けてもう一度リクエストしてください。"
    );
    return;
  }

  const history = loadHistory();
  let comments;
  try {
    comments = await generateComments({ author, postText, note }, history);
  } catch (err) {
    await postIssueComment(`コメント案の生成に失敗しました: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (comments.length === 0) {
    await postIssueComment("コメント案を生成できませんでした。もう一度お試しください。");
    return;
  }

  const parts = [];
  if (fetchNote) parts.push(fetchNote.trim());
  parts.push(`**コメント案(${comments.length}件)**`, "");
  comments.forEach((c, i) => parts.push(`${i + 1}. ${c}`));
  parts.push("", "気に入ったものをコピーして、Threadsアプリから手動でコメント投稿してください。");
  const message = parts.join("\n");

  await postIssueComment(message);
  await postDiscord(`📝 コメント案が届きました(#${ISSUE_NUMBER})\n\n${message}`);

  for (const comment of comments) {
    history.push({
      author: author || "",
      postText: postText.slice(0, 300),
      comment,
      source: "issue",
      issueNumber: ISSUE_NUMBER,
      createdAt: new Date().toISOString(),
    });
  }
  saveHistory(history);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
