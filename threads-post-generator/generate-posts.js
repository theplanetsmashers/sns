// generate-posts.js
// 「会社の裏設定」ネタ元から、毎日のThreads投稿案を自動生成してDiscordに通知するスクリプト。
// このバージョン(フェーズ1)は「案の生成のみ」。実際の投稿は人間が選んで手動で行う。

const fs = require("fs");
const path = require("path");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const POSTS_PER_DAY = parseInt(process.env.POSTS_PER_DAY || "3", 10);

const THEMES_PATH = path.join(__dirname, "themes.json");
const STATE_PATH = path.join(__dirname, "state", "used-themes.json");
// 反応データ(フェーズ3で日次記録される想定)。無ければ空配列として扱う。
const PERFORMANCE_PATH = path.join(__dirname, "state", "performance.json");

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function pickThemes(themes, usedIds, count) {
  // 未使用のテーマを優先。全部使い切ったら使用済みリストをリセットして再利用する。
  let candidates = themes.filter((t) => !usedIds.includes(t.id));
  if (candidates.length < count) {
    usedIds = [];
    candidates = themes;
  }
  // シャッフルして先頭からcount件取る
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return { picked: shuffled.slice(0, count), usedIds };
}

function buildPerformanceSummary(performance) {
  if (!performance || performance.length === 0) {
    return "(まだ反応データがありません。通常の判断で作成してください)";
  }
  // 直近の反応が良かった投稿・悪かった投稿を上位/下位3件ずつ要約してプロンプトに渡す
  const sorted = [...performance].sort((a, b) => (b.engagement || 0) - (a.engagement || 0));
  const top = sorted.slice(0, 3);
  const bottom = sorted.slice(-3);
  const fmt = (p) => `・「${p.title}」(反応スコア:${p.engagement}) 傾向メモ: ${p.note || "なし"}`;
  return [
    "【直近で反応が良かった投稿】",
    ...top.map(fmt),
    "【直近で反応が悪かった投稿】",
    ...bottom.map(fmt),
  ].join("\n");
}

async function generatePostDraft(theme, performanceSummary) {
  const prompt = `あなたは製造業の管理職向けに発信しているThreadsアカウント「PocketHappy」の投稿作成アシスタントです。
以下のネタ元を基に、Threads投稿文を1本作成してください。

【ネタ元】
タイトル: ${theme.title}
テーマ: ${theme.theme}
教訓: ${theme.lesson}
キーワード: ${theme.keywords.join("、")}

【過去の反応データ(参考にして書き方を調整すること)】
${performanceSummary}

【投稿の条件】
- Threadsなので日本語で300文字以内
- 冒頭1行で興味を引く(結論や問いかけから始める)
- 上から目線の説教にならないよう、共感ベースで書く
- 最後に一言、読者が今日から使える視点や問いを残す
- ハッシュタグは付けない
- Markdown記号(#や*など)は使わない

投稿文だけを出力してください。前置きや説明は不要です。`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  return textBlock ? textBlock.text.trim() : "(生成失敗)";
}

async function postToDiscord(drafts) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("DISCORD_WEBHOOK_URL未設定のため、Discord通知はスキップします。");
    return;
  }

  const lines = drafts.map((d, i) => {
    return `**${i + 1}. 元ネタ: ${d.theme.title}**\n${d.text}\n`;
  });

  const content = [
    `📝 本日のThreads投稿案 (${drafts.length}件)`,
    "",
    ...lines,
    "気に入ったものを選んで手動で投稿してください。",
  ].join("\n");

  // Discordの2000文字制限に配慮して分割送信
  const chunks = [];
  let current = "";
  for (const line of content.split("\n")) {
    if ((current + line).length > 1800) {
      chunks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunk }),
    });
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const themes = loadJson(THEMES_PATH, []);
  if (themes.length === 0) {
    throw new Error("themes.json にネタがありません。");
  }

  const state = loadJson(STATE_PATH, { used_ids: [] });
  const performance = loadJson(PERFORMANCE_PATH, []);

  const { picked, usedIds } = pickThemes(themes, state.used_ids, POSTS_PER_DAY);
  const performanceSummary = buildPerformanceSummary(performance);

  const drafts = [];
  for (const theme of picked) {
    console.log(`生成中: ${theme.title}`);
    const text = await generatePostDraft(theme, performanceSummary);
    drafts.push({ theme, text });
  }

  await postToDiscord(drafts);

  // 使用済みテーマを記録
  const newUsedIds = [...usedIds, ...picked.map((t) => t.id)];
  fs.writeFileSync(STATE_PATH, JSON.stringify({ used_ids: newUsedIds }, null, 2));

  // ログ出力(GitHub Actionsのartifact/確認用)
  const logPath = path.join(__dirname, "state", `generated-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(logPath, JSON.stringify(drafts, null, 2), "utf-8");

  console.log(`${drafts.length}件の投稿案を生成しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
