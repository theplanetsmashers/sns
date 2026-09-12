// generate-trend-report.js
// note.comの検索結果から競合・トレンドを分析し、次のnote記事のネタ案をDiscordに届けるスクリプト。
// GitHub Actionsで週次実行される想定。実際に書くかどうかの判断はこれまで通り人間が行う
// (自動投稿・自動執筆は行わない。あくまでネタ出しの壁打ち相手)。

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { searchNoteArticles } = require("./lib/searchNote");
const { generateTrendReport } = require("./lib/generateTrendReport");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const RESULTS_PER_KEYWORD = parseInt(process.env.RESULTS_PER_KEYWORD || "10", 10);
const HISTORY_LIMIT = 200;
const AVOID_TITLES_LIMIT = 30;

const KEYWORDS_PATH = path.join(__dirname, "keywords.json");
const HISTORY_PATH = path.join(__dirname, "state", "history.json");

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function collectSearchResults(keywords) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const collected = [];
  try {
    for (const kw of keywords) {
      console.log(`検索中: ${kw.label} (${kw.query})`);
      const articles = await searchNoteArticles(browser, kw.query, { limit: RESULTS_PER_KEYWORD });
      console.log(`  → ${articles.length}件`);
      collected.push({ label: kw.label, query: kw.query, articles });
    }
  } finally {
    await browser.close();
  }
  return collected;
}

async function postToDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("DISCORD_WEBHOOK_URL未設定のため、Discord通知はスキップします。");
    return;
  }

  const content = `📈 今週のnoteトレンド分析 & 次のネタ提案\n\n${text}`;

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

function extractProposedTitles(reportText) {
  const matches = [...reportText.matchAll(/^###\s*\d+\.\s*(.+)$/gm)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const keywords = loadJson(KEYWORDS_PATH, []);
  if (keywords.length === 0) {
    throw new Error("keywords.json にキーワードがありません。");
  }

  const history = loadJson(HISTORY_PATH, []);
  const avoidTitles = history.slice(-AVOID_TITLES_LIMIT).map((h) => h.title);

  const searchResults = await collectSearchResults(keywords);
  const totalArticles = searchResults.reduce((sum, r) => sum + r.articles.length, 0);

  if (totalArticles === 0) {
    console.warn("すべてのキーワードで検索結果が0件でした。note.comのページ構造/bot対策が変わった可能性があります。");
    await postToDiscord(
      "⚠️ note.comの検索結果を取得できませんでした(ページ構造が変わったか、アクセスがブロックされた可能性があります)。今週のトレンド分析はスキップします。note-trend-generator/lib/searchNote.js の確認をおすすめします。"
    );
    return;
  }

  const reportText = await generateTrendReport(searchResults, avoidTitles);
  await postToDiscord(reportText);

  const today = new Date().toISOString().slice(0, 10);
  const newTitles = extractProposedTitles(reportText);
  const newHistory = [...history, ...newTitles.map((title) => ({ date: today, title }))].slice(-HISTORY_LIMIT);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(newHistory, null, 2));

  const logPath = path.join(__dirname, "state", `trend-report-${today}.json`);
  fs.writeFileSync(logPath, JSON.stringify({ date: today, searchResults, reportText }, null, 2), "utf-8");

  console.log(`トレンド分析を完了し、${newTitles.length}件のネタ案をDiscordに送信しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
