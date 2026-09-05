// generate-template.js
// 「営業向けの暗黙知インタビューを作って」のように役割・職種を指定するだけで、
// Claudeに質問テンプレート(questions.json形式)を生成させ templates/ に保存するCLI。
// 既存の manufacturing-supervisor.json / general-tacit-knowledge.json と同じ形式
// ({id, category, question}の配列)で出力させ、他業種への展開を素早く行えるようにする。
//
// 使い方:
//   node generate-template.js --role="営業" --name=sales
//   node generate-template.js --role="コールセンターのオペレーター" --name=call-center --count=6

const fs = require("fs");
const engine = require("./lib/interview-engine");

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

function slugForTemplateName(role) {
  return (
    role
      .trim()
      .toLowerCase()
      .replace(/[^\w぀-ヿ一-鿿]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "custom-template"
  );
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("生成結果が質問の配列になっていません。");
  }
  const ids = new Set();
  for (const q of questions) {
    if (!q.id || !q.category || !q.question) {
      throw new Error(`不正な質問オブジェクトです: ${JSON.stringify(q)}`);
    }
    if (ids.has(q.id)) {
      throw new Error(`質問idが重複しています: ${q.id}`);
    }
    ids.add(q.id);
  }
  return questions;
}

async function generateTemplate(role, count) {
  const prompt = `あなたは「暗黙知インタビューボット」という製品の設計者です。
「${role}」という役割・職種の担当者から、暗黙知(マニュアルや数値だけでは伝わらない判断基準・感覚的な手がかり・失敗から学んだこと)を引き出すための、固定インタビュー質問テンプレートを${count}問作成してください。

参考として、製造業の現場管理職向けには以下のようなカテゴリの質問を使っています:
背景・役割 / 異常検知のきっかけ / 五感的な手がかり / 意思決定プロセス / 失敗・ヒヤリハット / 例外対応 / 後進への伝え方 / 継承したい想い

「${role}」の実態に合わせて、カテゴリ名や質問文はこの職種特有の表現に調整してください(例えば感覚的な手がかりが薄い職種なら、代わりに「相手の反応の見極め方」のようなカテゴリにするなど)。

出力は必ず以下のJSON配列形式のみ。前置き・説明・コードブロック記号は不要です。
[
  {"id": "英数字とアンダースコアのみのユニークなid", "category": "日本語のカテゴリ名", "question": "日本語の質問文"},
  ...
]`;

  const raw = await engine.callClaude(prompt, 2000);
  const jsonText = engine.stripJsonFence(raw);
  const questions = JSON.parse(jsonText);
  return validateQuestions(questions);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const role = args.role;
  if (!role) {
    throw new Error('使い方: node generate-template.js --role="営業" [--name=テンプレート名] [--count=8]');
  }
  const count = parseInt(args.count || "8", 10);
  const name = args.name || slugForTemplateName(role);

  console.log(`「${role}」向けのテンプレートを生成中... (${count}問)`);
  const questions = await generateTemplate(role, count);

  const filePath = engine.saveTemplate(name, questions);
  console.log(`\nテンプレートを保存しました: ${filePath}`);
  for (const q of questions) {
    console.log(`  - [${q.category}] ${q.question}`);
  }
  console.log(`\n次のコマンドでこのテンプレートを使ったインタビューを開始できます:`);
  console.log(`  npm run interview -- --template=${name}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { validateQuestions, slugForTemplateName };
