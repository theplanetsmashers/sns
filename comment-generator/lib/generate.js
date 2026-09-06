// lib/generate.js
// Claude APIを使って返信コメント案を3パターン生成する共通処理。
// server.js(Webアプリ)とbot.js(GitHub Actions版)の両方から使う。

function buildAvoidSummary(history) {
  const recent = history.slice(-15).map((h) => h.comment).filter(Boolean);
  if (recent.length === 0) return "(まだ履歴はありません)";
  return recent.map((c) => `・${c}`).join("\n");
}

async function generateComments({ author, postText, tone, note }, history) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const avoidSummary = buildAvoidSummary(history);

  const prompt = `あなたはThreadsやSNSで、他の人の投稿に返信コメントを書くのを手伝うアシスタントです。
以下の投稿に対して、自然で気取らない返信コメントを3パターン作成してください。

【コメントするアカウントの普段のトーン】
${tone || "共感ベースで、上から目線にならない自然体。絵文字は使っても0〜1個程度。"}

【コメント対象の投稿】
投稿者: ${author || "(不明)"}
投稿内容:
${postText}

${note ? `【追加の指示・文脈】\n${note}\n` : ""}
【直近で使ったコメント文(似た言い回しの繰り返しを避けること)】
${avoidSummary}

【コメントの条件】
- 日本語で100文字以内、1〜2文
- 説教や上から目線にならない。共感・驚き・自分ごと化・具体的な問いかけなど、視点を交える
- 3パターンはそれぞれ違うアプローチにする(例: 共感型、質問型、気づき共有型)
- そのままコピペしてすぐ使える自然な文章にする
- Markdown記号(#や*など)は使わない

出力は次のJSON形式の配列のみ。前置きや説明、コードブロックは一切つけないこと。
["コメント案1", "コメント案2", "コメント案3"]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
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
  const raw = textBlock ? textBlock.text.trim() : "[]";

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((s) => String(s).trim()).filter(Boolean);
    }
  } catch {
    // JSONとして読めなかった場合は行分割にフォールバック
  }
  return raw
    .split("\n")
    .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

module.exports = { generateComments, buildAvoidSummary };
