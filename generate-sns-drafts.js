// generate-sns-drafts.js
// note記事(1本)から、フックの効いたThreads投稿文とX投稿文を自動生成し、
// コピーしやすい形でDiscordに通知するスクリプト。
// note・Threads・Xへの投稿はすべて手動・別タイミングで行う(このスクリプトは下書き生成のみ)。

const fs = require("fs");
const path = require("path");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const THREADS_LIMIT = 500;
const X_LIMIT = 280;

function readArticle(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const title = path.basename(filePath, path.extname(filePath));
  return { title, body: raw.trim() };
}

async function generateDrafts(article) {
  const prompt = `あなたはnote記事の内容を元に、Threads・X(旧Twitter)向けの告知投稿を作るアシスタントです。
以下はこれから公開するnote記事の本文です。

【note記事】
${article.body}

【依頼内容】
この記事を要約し、フックの効いたThreads投稿文とX投稿文をそれぞれ1本ずつ作成してください。

【共通条件】
- 冒頭1行で興味を引く(結論・数字・問いかけなど)
- 記事の一番面白い/役に立つポイントを先出しする
- 「続きはnoteで」等、note記事へ誘導する一言を末尾に入れる(URLは書かなくてよい。あとで手動で貼るため)
- ハッシュタグは付けない
- Markdown記号(#や*など)は使わない

【Threads投稿の条件】
- 日本語で${THREADS_LIMIT}文字以内

【X投稿の条件】
- 日本語で${X_LIMIT}文字以内(Threadsよりさらに簡潔に)

【出力形式】
以下の形式そのままで出力してください。前置きや説明は不要です。

===THREADS===
(ここにThreads投稿文)
===X===
(ここにX投稿文)`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const raw = textBlock ? textBlock.text.trim() : "";

  const threadsMatch = raw.match(/===THREADS===([\s\S]*?)===X===/);
  const xMatch = raw.match(/===X===([\s\S]*)/);

  const threadsText = threadsMatch ? threadsMatch[1].trim() : "(生成失敗: THREADSブロックが見つかりません)";
  const xText = xMatch ? xMatch[1].trim() : "(生成失敗: Xブロックが見つかりません)";

  return { threadsText, xText };
}

async function postToDiscord(article, drafts) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("DISCORD_WEBHOOK_URL未設定のため、Discord通知はスキップします。");
    return;
  }

  // コードブロック(```)にするとDiscord上でワンタップ/ワンクリックコピーができるため、
  // ブロックの中には投稿文だけを入れる(見出しはブロックの外に置く)。
  const content = [
    `📝 「${article.title}」のSNS下書きができました`,
    "",
    "**Threads用**(タップでコピー)",
    "```",
    drafts.threadsText,
    "```",
    "**X用**(タップでコピー)",
    "```",
    drafts.xText,
    "```",
    "note投稿は手動で、好きなタイミングでどうぞ。",
  ].join("\n");

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Discord webhook error: ${res.status} ${errText}`);
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const filePaths = process.argv.slice(2).filter(Boolean);
  if (filePaths.length === 0) {
    throw new Error(
      "処理する記事ファイルのパスを指定してください。例: node generate-sns-drafts.js articles/my-post.md"
    );
  }

  const logDir = path.join(__dirname, "state");
  fs.mkdirSync(logDir, { recursive: true });

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      console.warn(`ファイルが見つかりません(スキップ): ${filePath}`);
      continue;
    }
    const article = readArticle(filePath);
    console.log(`生成中: ${article.title}`);
    const drafts = await generateDrafts(article);
    await postToDiscord(article, drafts);

    const logPath = path.join(logDir, `sns-drafts-${article.title}.json`);
    fs.writeFileSync(logPath, JSON.stringify({ article: article.title, ...drafts }, null, 2), "utf-8");

    console.log(`完了: ${article.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
