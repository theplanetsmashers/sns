// interview.js
// 暗黙知インタビューボット MVP: 固定テンプレート質問→回答→深掘り判定→要約 のループを
// ターミナル上で回し、1回のインタビューの記録をJSONで保存するスクリプト。
// 保存したセッションは generate-outputs.js に渡すと、マニュアル/研修ケース/note記事の
// 3種類のアウトプットを自動生成できる。

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const SESSIONS_DIR = path.join(__dirname, "sessions");

function askLine(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// 複数行入力を受け付け、空行が来たら終了する
async function askMultiline(rl, prompt) {
  console.log(prompt);
  console.log("(回答を入力してください。入力し終えたら空行でEnter)");
  const lines = [];
  while (true) {
    const line = await askLine(rl, "> ");
    if (line.trim() === "") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

async function callClaude(prompt, maxTokens = 1000) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  return textBlock ? textBlock.text.trim() : "";
}

// 回答を評価し、深掘りが必要かどうかと要約をJSONで返してもらう
async function analyzeAnswer(category, question, answer) {
  const prompt = `あなたは製造業のベテラン技能者から暗黙知を引き出すインタビュアーです。
以下の質問と回答を読み、次の2つを判断してください。

【質問カテゴリ】${category}
【質問】${question}
【回答】${answer}

1. この回答は、他人がマニュアル化・再現できるほど具体的か?抽象的すぎたり一般論に留まっている場合は、深掘りの追加質問を1つ考えてください。
2. 回答から読み取れる暗黙知のポイントを2〜4行で要約してください(判断基準・感覚的な手がかり・失敗の芽など、マニュアルに落とし込める要素を優先すること)。

出力は必ず以下のJSON形式のみ。前置きや説明、コードブロック記号は不要です。
{"needs_followup": true か false, "followup_question": "深掘りが不要ならから文字列", "summary": "要約テキスト"}`;

  const raw = await callClaude(prompt, 600);
  try {
    const jsonText = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(jsonText);
  } catch (e) {
    // パース失敗時はフォールバック(深掘りなしで生の回答を要約扱いにする)
    return { needs_followup: false, followup_question: "", summary: answer };
  }
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, "utf-8"));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("=== 暗黙知インタビューボット ===");
  const intervieweeName = await askLine(rl, "インタビュー対象者の名前(または匿名の呼び名)を入力してください: ");
  const topic = await askLine(rl, "今回のテーマ(担当していた工程・設備・役割など)を一言で: ");

  const records = [];

  for (const q of questions) {
    console.log(`\n--- [${q.category}] ---`);
    const answer = await askMultiline(rl, q.question);
    if (!answer) {
      console.log("(回答が空だったため、この質問はスキップします)");
      continue;
    }

    console.log("...回答を分析中...");
    const analysis = await analyzeAnswer(q.category, q.question, answer);

    let followupQuestion = "";
    let followupAnswer = "";
    if (analysis.needs_followup && analysis.followup_question) {
      console.log(`\n(深掘り質問) ${analysis.followup_question}`);
      followupQuestion = analysis.followup_question;
      followupAnswer = await askMultiline(rl, followupQuestion);
    }

    let summary = analysis.summary;
    if (followupAnswer) {
      console.log("...深掘り回答を踏まえて要約を更新中...");
      const combined = await analyzeAnswer(
        q.category,
        `${q.question}\n(深掘り) ${followupQuestion}`,
        `${answer}\n(深掘り回答) ${followupAnswer}`
      );
      summary = combined.summary;
    }

    console.log(`要約: ${summary}`);

    records.push({
      id: q.id,
      category: q.category,
      question: q.question,
      answer,
      followup_question: followupQuestion,
      followup_answer: followupAnswer,
      summary,
    });
  }

  rl.close();

  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = topic.trim().replace(/[^\w぀-ヿ一-鿿]+/g, "_").slice(0, 30) || "session";
  const sessionPath = path.join(SESSIONS_DIR, `${timestamp}_${slug}.json`);

  fs.writeFileSync(
    sessionPath,
    JSON.stringify({ interviewee: intervieweeName, topic, created_at: timestamp, records }, null, 2),
    "utf-8"
  );

  console.log(`\nインタビュー記録を保存しました: ${sessionPath}`);
  console.log(`次のコマンドでマニュアル・研修ケース・note記事を生成できます:`);
  console.log(`  npm run outputs -- ${sessionPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
