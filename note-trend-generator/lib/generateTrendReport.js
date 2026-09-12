// lib/generateTrendReport.js
// 収集したnote検索結果からトレンドを分析し、次のnote記事のネタを提案する文章をClaude APIで生成する。

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function formatSearchResults(searchResults) {
  return searchResults
    .map(({ label, articles }) => {
      if (articles.length === 0) {
        return `■ キーワード「${label}」\n(検索結果を取得できませんでした)`;
      }
      const lines = articles.map((a) => `・${a.title}`);
      return `■ キーワード「${label}」\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

async function generateTrendReport(searchResults, avoidTitles) {
  const resultsText = formatSearchResults(searchResults);
  const avoidText =
    avoidTitles.length > 0 ? avoidTitles.map((t) => `・${t}`).join("\n") : "(まだ提案履歴がありません)";

  const prompt = `あなたは製造業の管理職向けnoteマガジンの編集アシスタントです。
以下は、関連キーワードでnote.comを検索して集めた、最近ヒットしている記事のタイトル一覧です(競合・トレンド調査用)。

【検索結果】
${resultsText}

【直近で提案済みのネタ(重複や似すぎた切り口を避けること)】
${avoidText}

上記を踏まえて、次の2つを行ってください。

1. トレンド分析: 検索結果から見えてくる、いま読まれやすい切り口・テーマの傾向を3〜5行程度で要約する
2. 次のnote記事ネタ提案: このアカウントの読者(製造業の管理職)に刺さりそうな、次に書くべきnote記事のネタを3件提案する。それぞれ「タイトル案」「フック(冒頭でどう惹きつけるか)」「構成(3〜5個の見出し案)」をセットで書く。Threadsの短文投稿(会社の裏設定シリーズ)とは違い、note記事らしい長文向けで深掘りできる切り口にすること

出力形式(このMarkdown形式を厳守すること):
## トレンド分析
(ここに分析)

## 次のnote記事ネタ提案
### 1. (タイトル案)
- フック: ...
- 構成: ...
### 2. (タイトル案)
- フック: ...
- 構成: ...
### 3. (タイトル案)
- フック: ...
- 構成: ...

前置きや説明は不要です。上記の形式のテキストだけを出力してください。`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
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

module.exports = { generateTrendReport };
