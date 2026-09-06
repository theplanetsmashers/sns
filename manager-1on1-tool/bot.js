// bot.js
// GitHub Issueを入力フォーム代わりにした1on1支援ボット(GitHub Actionsから実行)。
// スマホからIssueを1件作るだけで、部下登録/1on1準備/1on1後記録/傾向分析を実行し、
// 結果をIssueコメントとDiscordに届ける。状態(部下プロフィール・ログ)はリポジトリに
// コミットして永続化する(ワークフロー側で state/*.json をコミット)。

const crypto = require("crypto");
const {
  loadSubordinates,
  saveSubordinates,
  loadLogs,
  saveLogs,
  logsForSubordinate,
} = require("./lib/store");
const { generateAgenda, summarizeLog, generateTrend } = require("./lib/generate");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_BODY = process.env.ISSUE_BODY || "";
const ISSUE_LABELS = (process.env.ISSUE_LABELS || "").split(",").map((l) => l.trim());

// GitHubのIssueフォームは "### ラベル\n\n値" という形式でbodyを生成する。
function parseField(body, label) {
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

function findSubordinate(subordinates, targetName) {
  const norm = targetName.trim().toLowerCase();
  return (
    subordinates.find((s) => s.name.trim().toLowerCase() === norm) ||
    subordinates.find((s) => s.name.trim().toLowerCase().includes(norm) || norm.includes(s.name.trim().toLowerCase()))
  );
}

function subordinateListText(subordinates) {
  if (subordinates.length === 0) return "(まだ誰も登録されていません。先に「部下登録」のIssueを作成してください)";
  return subordinates
    .map((s) => `・${s.name}(${s.type === "delegate" ? "委任先チームリーダー" : "直属部下"})`)
    .join("\n");
}

function agendaToText(agenda) {
  if (agenda.length === 0) return "(アジェンダ案を生成できませんでした)";
  return agenda
    .map((item, i) => `${i + 1}. **${item.topic}**\n   - なぜ今回扱うか: ${item.reason}\n   - 問いかけ例: ${item.question}`)
    .join("\n\n");
}

function listOrNone(items) {
  if (!items || items.length === 0) return "(なし)";
  return items.map((i) => `・${i}`).join("\n");
}

async function handleRegister() {
  const name = parseField(ISSUE_BODY, "名前");
  if (!name) {
    await postIssueComment("名前が入力されていません。「名前」欄を入力してもう一度Issueを作成してください。");
    return;
  }
  const role = parseField(ISSUE_BODY, "役割");
  const experienceYears = parseField(ISSUE_BODY, "経験年数");
  const typeRaw = parseField(ISSUE_BODY, "関係");
  const type = typeRaw.includes("委任") ? "delegate" : "direct";
  const note = parseField(ISSUE_BODY, "メモ");

  const subordinates = loadSubordinates();
  const entry = {
    id: crypto.randomUUID(),
    name,
    role,
    experienceYears,
    type,
    note,
    createdAt: new Date().toISOString(),
  };
  subordinates.push(entry);
  saveSubordinates(subordinates);

  const message = `**部下を登録しました**\n\n・名前: ${name}\n・役割: ${role || "(未記入)"}\n・経験年数: ${experienceYears || "(未記入)"}\n・関係: ${type === "delegate" ? "委任先チームリーダー" : "直属部下"}\n\n現在の登録一覧:\n${subordinateListText(subordinates)}`;
  await postIssueComment(message);
  await postDiscord(`✅ 部下を登録しました(#${ISSUE_NUMBER})\n${name}(${type === "delegate" ? "委任先チームリーダー" : "直属部下"})`);
}

async function handleAgenda() {
  const target = parseField(ISSUE_BODY, "対象");
  const recentStatus = parseField(ISSUE_BODY, "直近の業務状況");
  const subordinates = loadSubordinates();
  const subordinate = target && findSubordinate(subordinates, target);
  if (!subordinate) {
    await postIssueComment(
      `対象の部下が見つかりませんでした(入力値: ${target || "(空欄)"})。登録名と完全に一致する表記で入力し直してください。\n\n現在の登録一覧:\n${subordinateListText(subordinates)}`
    );
    return;
  }
  const logs = logsForSubordinate(loadLogs(), subordinate.id);
  const agenda = await generateAgenda({ subordinate, recentStatus, logs });
  const message = `**${subordinate.name} との1on1アジェンダ案**\n\n${agendaToText(agenda)}`;
  await postIssueComment(message);
  await postDiscord(`🗒️ 1on1アジェンダ案が届きました(#${ISSUE_NUMBER})\n${subordinate.name}\n\n${message}`);
}

async function handleLog() {
  const target = parseField(ISSUE_BODY, "対象");
  const date = parseField(ISSUE_BODY, "実施日") || new Date().toISOString().slice(0, 10);
  const memo = parseField(ISSUE_BODY, "1on1メモ") || parseField(ISSUE_BODY, "メモ");
  const subordinates = loadSubordinates();
  const subordinate = target && findSubordinate(subordinates, target);
  if (!subordinate) {
    await postIssueComment(
      `対象の部下が見つかりませんでした(入力値: ${target || "(空欄)"})。登録名と完全に一致する表記で入力し直してください。\n\n現在の登録一覧:\n${subordinateListText(subordinates)}`
    );
    return;
  }
  if (!memo) {
    await postIssueComment("1on1メモが入力されていません。「1on1メモ」欄を入力してもう一度Issueを作成してください。");
    return;
  }
  const allLogs = loadLogs();
  const pastLogs = logsForSubordinate(allLogs, subordinate.id);
  const summary = await summarizeLog({ subordinate, memo, logs: pastLogs });
  const entry = {
    id: crypto.randomUUID(),
    subordinateId: subordinate.id,
    date,
    memo,
    summary,
    createdAt: new Date().toISOString(),
  };
  allLogs.push(entry);
  saveLogs(allLogs);

  const message = `**${subordinate.name} との1on1記録(${date})**\n\n要点:\n${listOrNone(summary.keyPoints)}\n\n判断基準:\n${listOrNone(summary.judgmentCriteria)}\n\n次回フォロー:\n${listOrNone(summary.followUps)}`;
  await postIssueComment(message);
  await postDiscord(`📋 1on1記録を保存しました(#${ISSUE_NUMBER})\n${subordinate.name}(${date})\n\n${message}`);
}

async function handleTrend() {
  const target = parseField(ISSUE_BODY, "対象");
  const subordinates = loadSubordinates();
  const subordinate = target && findSubordinate(subordinates, target);
  if (!subordinate) {
    await postIssueComment(
      `対象の部下が見つかりませんでした(入力値: ${target || "(空欄)"})。登録名と完全に一致する表記で入力し直してください。\n\n現在の登録一覧:\n${subordinateListText(subordinates)}`
    );
    return;
  }
  const logs = logsForSubordinate(loadLogs(), subordinate.id);
  const trend = await generateTrend({ subordinate, logs });
  const message = `**${subordinate.name} の傾向サマリー(記録${logs.length}件)**\n\n${trend.summary}\n\n注目すべき兆候:\n${listOrNone(trend.signals)}`;
  await postIssueComment(message);
  await postDiscord(`📈 傾向サマリーが届きました(#${ISSUE_NUMBER})\n${subordinate.name}\n\n${message}`);
}

async function main() {
  if (ISSUE_LABELS.includes("1on1-register")) return handleRegister();
  if (ISSUE_LABELS.includes("1on1-agenda")) return handleAgenda();
  if (ISSUE_LABELS.includes("1on1-log")) return handleLog();
  if (ISSUE_LABELS.includes("1on1-trend")) return handleTrend();
  console.log("対象ラベルが見つからないためスキップしました:", ISSUE_LABELS);
}

main().catch(async (err) => {
  console.error(err);
  await postIssueComment(`処理中にエラーが発生しました: ${err.message}`);
  process.exitCode = 1;
});
