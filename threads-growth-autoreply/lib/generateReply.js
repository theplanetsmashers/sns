// lib/generateReply.js
// 伸びている自分の投稿に届いたコメントに対する、短い返信文をClaude APIで生成する。
// comment-generator/lib/generate.js(他人の投稿へのコメント案・3パターン生成)とは異なり、
// こちらは「自分の投稿へのコメントへの返信を1本だけ」生成し、そのままThreads APIで自動投稿する。

function buildAvoidSummary(records) {
  const recent = records.slice(-15).map((r) => r.replyText).filter(Boolean);
  if (recent.length === 0) return "(まだ返信履歴はありません)";
  return recent.map((t) => `・${t}`).join("\n");
}

async function generateReply({ postText, commentAuthor, commentText, tone }, recentRecords) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const avoidSummary = buildAvoidSummary(recentRecords || []);

  const prompt = `あなたはThreadsアカウントの運営者本人として、自分の投稿に届いたコメントに短く返信するアシスタントです。

【普段のトーン】
${tone || "気取らずフラットで、上から目線にならない自然体。絵文字は使っても0〜1個程度。"}

【自分が投稿した内容】
${postText}

【届いたコメント】
コメント主: ${commentAuthor || "(不明)"}
コメント内容:
${commentText}

【直近で使った返信文(似た言い回しの繰り返しを避けること)】
${avoidSummary}

【返信の条件】
- 日本語で40文字以内、1文のみ
- お礼や共感、一言の相槌など、短く自然なリアクションにする
- 説教や訂正、長い説明にはしない
- Markdown記号(#や*など)は使わない
- 相手の名前(@ユーザー名など)は付けない

返信文だけを出力してください。前置きや説明、引用符は一切つけないこと。`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  let text = textBlock ? textBlock.text.trim() : "";
  // 稀に引用符やMarkdown見出しが混ざることがあるための簡易サニタイズ
  text = text.replace(/^["'「]|["'」]$/g, "").trim();
  if (!text) throw new Error("返信文を生成できませんでした(空文字)");
  return text.slice(0, 100);
}

module.exports = { generateReply, buildAvoidSummary };
