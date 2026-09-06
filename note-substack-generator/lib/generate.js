// lib/generate.js
// Claude APIを使って、日本語のnote記事からSubstack用の英語導入記事を生成する処理。

function buildPrompt({ articleText, articleUrl, tone, note }) {
  const translatedUrl = articleUrl
    ? articleUrl.includes("?")
      ? `${articleUrl}&hl=en`
      : `${articleUrl}?hl=en`
    : "";

  return `あなたは日本語の記事を、Substackの英語圏読者向けに紹介するライターです。
以下の日本語のnote記事を読み、その内容をそのまま全訳するのではなく、
Substackの新規読者が「続きを読みたい」と思うような英語の導入記事(イントロ/ティザー記事)を1本作成してください。

【元のnote記事(日本語)】
${articleText}

${articleUrl ? `【元記事のURL】\n${articleUrl}\n${translatedUrl ? `【note自動翻訳版のURL(?hl=enを付与済み)】\n${translatedUrl}\n` : ""}` : ""}
${tone ? `【文体・トーンの指定】\n${tone}\n` : ""}
${note ? `【追加の指示】\n${note}\n` : ""}
【生成する英語記事の条件】
- 完全に英語で書くこと(日本語を残さない)
- Substackらしい、個人的で親しみやすい語り口のフック(hook)から始める
- 元記事を逐語訳するのではなく、海外読者にとって興味深いポイント・文脈(日本特有の背景など)を補いながら要約・紹介する
- 分量は400〜600語程度
- 記事の最後に、続きを読むための自然な一文と、リンクを案内する(${translatedUrl || "元記事のURL"} を使うこと。URLが無い場合はリンクへの言及は省略してよい)
- MarkdownのH1見出し(#)を1つ、記事タイトルとして先頭に付ける
- 出力は生成した記事本文のみ。前置き、説明、コードブロック記号は一切つけないこと`;
}

async function generateIntro({ articleText, articleUrl, tone, note }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const prompt = buildPrompt({ articleText, articleUrl, tone, note });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const article = textBlock ? textBlock.text.trim() : "";
  if (!article) {
    throw new Error("記事を生成できませんでした。");
  }
  return article;
}

module.exports = { generateIntro, buildPrompt };
