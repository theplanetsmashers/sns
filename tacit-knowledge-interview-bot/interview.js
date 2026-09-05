// interview.js
// 暗黙知インタビューボット MVP: 質問テンプレート→回答→深掘り判定→要約 のループを回し、
// 1回のインタビューの記録をJSONで保存するCLI。
//
// 使い方:
//   node interview.js                                  対話モード(デフォルトテンプレート)
//   node interview.js --template=general-tacit-knowledge  テンプレートを指定
//   node interview.js --list-templates                 利用可能なテンプレート一覧を表示
//   node interview.js --resume=sessions/xxx.json        中断したインタビューを再開
//   node interview.js --answers=examples/sample-answers.json --interviewee=... --topic=... \
//       --consent-internal=yes --consent-public=no      非対話モード(CI・自動テスト・外部連携向け)
//
// 保存したセッションは generate-outputs.js に渡すと、マニュアル/研修ケース/note記事の
// 3種類のアウトプットを自動生成できる。

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TEMPLATES_DIR = path.join(__dirname, "templates");
const SESSIONS_DIR = path.join(__dirname, "sessions");
const DEFAULT_TEMPLATE = "manufacturing-supervisor";

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

function listTemplateNames() {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function loadTemplate(name) {
  const filePath = path.join(TEMPLATES_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `テンプレート "${name}" が見つかりません。利用可能: ${listTemplateNames().join(", ")}`
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function askLine(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function askYesNo(rl, prompt, defaultNo = true) {
  const suffix = defaultNo ? "(yes/NO)" : "(YES/no)";
  const answer = await askLine(rl, `${prompt} ${suffix}: `);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return !defaultNo;
  return normalized === "yes" || normalized === "y";
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

// 回答を評価し、深掘りの要否・要約・暗黙知の濃さ(richness_score)をJSONで返してもらう
async function analyzeAnswer(category, question, answer) {
  const prompt = `あなたは製造業のベテラン技能者から暗黙知を引き出すインタビュアーです。
以下の質問と回答を読み、次の3つを判断してください。

【質問カテゴリ】${category}
【質問】${question}
【回答】${answer}

1. この回答は、他人がマニュアル化・再現できるほど具体的か?抽象的すぎたり一般論に留まっている場合は、深掘りの追加質問を1つ考えてください。
2. 回答から読み取れる暗黙知のポイントを2〜4行で要約してください(判断基準・感覚的な手がかり・失敗の芽など、マニュアルに落とし込める要素を優先すること)。
3. この回答の「暗黙知の濃さ」を1〜5の整数で評価してください(1=一般論・表面的、5=他人が再現できるレベルまで具体的)。

出力は必ず以下のJSON形式のみ。前置きや説明、コードブロック記号は不要です。
{"needs_followup": true か false, "followup_question": "深掘りが不要なら空文字列", "summary": "要約テキスト", "richness_score": 1から5の整数}`;

  const raw = await callClaude(prompt, 600);
  try {
    const jsonText = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonText);
    if (typeof parsed.richness_score !== "number") parsed.richness_score = 3;
    return parsed;
  } catch (e) {
    // パース失敗時はフォールバック(深掘りなしで生の回答を要約扱いにする)
    return { needs_followup: false, followup_question: "", summary: answer, richness_score: 3 };
  }
}

function slugify(text) {
  return (
    text
      .trim()
      .replace(/[^\w぀-ヿ一-鿿]+/g, "_")
      .slice(0, 30) || "session"
  );
}

function saveSession(sessionPath, session) {
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
}

async function runInterviewLoop(rl, session, template, answersBook, sessionPath) {
  const answeredIds = new Set(session.records.map((r) => r.id));

  for (const q of template) {
    if (answeredIds.has(q.id)) continue;

    console.log(`\n--- [${q.category}] ---`);

    let answer;
    let presetFollowupAnswer = "";
    const isBatch = !!answersBook;

    if (isBatch) {
      const entry = answersBook[q.id];
      answer = entry ? String(entry.answer || "").trim() : "";
      presetFollowupAnswer = entry ? String(entry.followup_answer || "").trim() : "";
      console.log(q.question);
      console.log(answer ? `(回答済み) ${answer}` : "(回答なし: スキップ)");
    } else {
      answer = await askMultiline(rl, q.question);
    }

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
      if (isBatch) {
        followupAnswer = presetFollowupAnswer;
        console.log(followupAnswer ? `(回答済み) ${followupAnswer}` : "(深掘り回答なし: 未回答のまま進みます)");
      } else {
        followupAnswer = await askMultiline(rl, followupQuestion);
      }
    }

    let summary = analysis.summary;
    let richnessScore = analysis.richness_score;
    if (followupAnswer) {
      console.log("...深掘り回答を踏まえて要約を更新中...");
      const combined = await analyzeAnswer(
        q.category,
        `${q.question}\n(深掘り) ${followupQuestion}`,
        `${answer}\n(深掘り回答) ${followupAnswer}`
      );
      summary = combined.summary;
      richnessScore = combined.richness_score;
    }

    console.log(`要約: ${summary} (濃さ: ${richnessScore}/5)`);

    session.records.push({
      id: q.id,
      category: q.category,
      question: q.question,
      answer,
      followup_question: followupQuestion,
      followup_answer: followupAnswer,
      summary,
      richness_score: richnessScore,
    });

    // 中断・クラッシュ時にも記録を失わないよう、質問ごとに保存する
    saveSession(sessionPath, session);
  }
}

function printFollowUpSuggestions(session) {
  const thin = session.records.filter((r) => r.richness_score <= 2);
  if (thin.length === 0) return;
  console.log("\n以下のカテゴリは内容が抽象的なままでした。別セッションで深掘りをおすすめします:");
  for (const r of thin) {
    console.log(`  - [${r.category}] 濃さ${r.richness_score}/5`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args["list-templates"]) {
    console.log("利用可能なテンプレート:");
    for (const name of listTemplateNames()) console.log(`  - ${name}`);
    return;
  }

  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const isBatch = !!args.answers;
  const rl = isBatch ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

  let session;
  let sessionPath;
  let template;

  if (args.resume) {
    sessionPath = path.resolve(args.resume);
    if (!fs.existsSync(sessionPath)) {
      throw new Error(`再開対象のセッションファイルが見つかりません: ${sessionPath}`);
    }
    session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
    template = loadTemplate(session.template || DEFAULT_TEMPLATE);
    console.log(`セッションを再開します: ${sessionPath} (残り ${template.length - session.records.length} 問)`);
  } else {
    const templateName = args.template || DEFAULT_TEMPLATE;
    template = loadTemplate(templateName);

    let interviewee = args.interviewee;
    let topic = args.topic;
    let consentInternal;
    let consentPublic;

    if (isBatch) {
      if (!interviewee || !topic) {
        throw new Error("非対話モード(--answers)では --interviewee と --topic の指定が必須です。");
      }
      consentInternal = String(args["consent-internal"] || "no").toLowerCase() === "yes";
      consentPublic = String(args["consent-public"] || "no").toLowerCase() === "yes";
    } else {
      console.log("=== 暗黙知インタビューボット ===");
      interviewee = interviewee || (await askLine(rl, "インタビュー対象者の名前(または匿名の呼び名)を入力してください: "));
      topic = topic || (await askLine(rl, "今回のテーマ(担当していた工程・設備・役割など)を一言で: "));
      consentInternal = await askYesNo(rl, "この記録を社内マニュアル・研修資料の元データとして利用してよいですか?", true);
      consentPublic = consentInternal
        ? await askYesNo(rl, "この記録をnote/ブログなど社外向け記事の元データとして利用してよいですか?", true)
        : false;
    }

    if (!consentInternal) {
      console.log("\n社内利用への同意がないため、インタビューを中止します。記録は保存されません。");
      if (rl) rl.close();
      return;
    }

    session = {
      interviewee,
      topic,
      template: templateName,
      created_at: new Date().toISOString(),
      consent: { internal: consentInternal, public: consentPublic },
      records: [],
    };

    const timestamp = session.created_at.replace(/[:.]/g, "-");
    sessionPath = path.join(SESSIONS_DIR, `${timestamp}_${slugify(topic)}.json`);
    saveSession(sessionPath, session);
  }

  let answersBook = null;
  if (isBatch) {
    const answersPath = path.resolve(args.answers);
    if (!fs.existsSync(answersPath)) {
      throw new Error(`回答ファイルが見つかりません: ${answersPath}`);
    }
    answersBook = JSON.parse(fs.readFileSync(answersPath, "utf-8"));
  }

  await runInterviewLoop(rl, session, template, answersBook, sessionPath);

  if (rl) rl.close();

  console.log(`\nインタビュー記録を保存しました: ${sessionPath}`);
  printFollowUpSuggestions(session);
  console.log(`\n次のコマンドでマニュアル・研修ケース・note記事を生成できます:`);
  console.log(`  npm run outputs -- ${sessionPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadTemplate, listTemplateNames, slugify };
