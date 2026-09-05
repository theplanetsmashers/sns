// generate-outputs.js
// interview.js が保存したセッションJSONを読み込み、以下3種類のアウトプットを
// Claude APIで生成してMarkdownファイルに書き出すスクリプト。
//   1. 社内向け技術継承マニュアル(PFMEA的な留意点込み)
//   2. 研修用ケーススタディ(判断プロセスを追体験できる形式)
//   3. note/ブログ用の一般公開記事
//
// 使い方: node generate-outputs.js sessions/xxxx.json

const fs = require("fs");
const path = require("path");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OUTPUTS_DIR = path.join(__dirname, "outputs");

async function callClaude(prompt, maxTokens = 2000) {
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

function buildTranscript(session) {
  return session.records
    .map((r) => {
      const parts = [
        `【${r.category}】`,
        `Q: ${r.question}`,
        `A: ${r.answer}`,
      ];
      if (r.followup_question) {
        parts.push(`深掘りQ: ${r.followup_question}`);
        parts.push(`深掘りA: ${r.followup_answer}`);
      }
      parts.push(`要約: ${r.summary}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

async function generateManual(session, transcript) {
  const prompt = `以下は製造業の技能者「${session.interviewee}」への、テーマ「${session.topic}」に関する暗黙知インタビューの記録です。
この内容を、社内向けの技術継承マニュアルとしてMarkdown形式でまとめてください。

【構成】
1. 概要(この技能・工程の位置づけ)
2. 正常時の判断基準・作業のポイント(五感的な手がかりも含める)
3. 起こりうる失敗モード一覧(PFMEA的に:失敗モード / 想定原因 / 影響 / 予防策・検知方法 を表形式で)
4. イレギュラー発生時の対応フロー(誰に相談するか含む)
5. 後任者への申し送り事項

インタビュー記録:
${transcript}

Markdownのみを出力してください。前置きは不要です。`;
  return callClaude(prompt, 2500);
}

async function generateCaseStudy(session, transcript) {
  const prompt = `以下は製造業の技能者「${session.interviewee}」への、テーマ「${session.topic}」に関する暗黙知インタビューの記録です。
この内容を元に、研修用のケーススタディをMarkdown形式で作成してください。
新人が実際の現場に近い形で「気づき→判断の分かれ道→選択とその結果→教訓」を追体験できるストーリー形式にしてください。

【構成】
1. 状況設定(架空の現場シーンとして描写)
2. 「あなたならどうする?」という問いかけ(選択肢を2〜3個提示)
3. ベテランが実際に取った判断とその理由
4. 結果と教訓
5. 振り返り設問(研修の場でディスカッションできる問い)

インタビュー記録:
${transcript}

Markdownのみを出力してください。前置きは不要です。`;
  return callClaude(prompt, 2500);
}

async function generateArticle(session, transcript) {
  const prompt = `以下は製造業の技能者「${session.interviewee}」への、テーマ「${session.topic}」に関する暗黙知インタビューの記録です。
この内容を元に、note/ブログ向けの一般公開記事を作成してください。

【トーンとルール】
- 一人称の体験談として、共感ベースで書く(上から目線の説教にしない)
- 冒頭1行で読者の興味を引く(結論や問いかけから始める)
- 専門用語は噛み砕いて説明する
- 最後に、読者が今日から使える視点や問いを1つ残す
- 2000〜3000文字程度

インタビュー記録:
${transcript}

記事本文のみを出力してください。前置きは不要です。`;
  return callClaude(prompt, 3000);
}

async function main() {
  const sessionArg = process.argv[2];
  if (!sessionArg) {
    throw new Error("使い方: node generate-outputs.js <セッションJSONのパス>");
  }
  const sessionPath = path.resolve(sessionArg);
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`セッションファイルが見つかりません: ${sessionPath}`);
  }

  const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
  const transcript = buildTranscript(session);

  const baseName = path.basename(sessionPath, ".json");
  const outDir = path.join(OUTPUTS_DIR, baseName);
  fs.mkdirSync(outDir, { recursive: true });

  console.log("マニュアルを生成中...");
  const manual = await generateManual(session, transcript);
  fs.writeFileSync(path.join(outDir, "manual.md"), manual, "utf-8");

  console.log("研修用ケーススタディを生成中...");
  const caseStudy = await generateCaseStudy(session, transcript);
  fs.writeFileSync(path.join(outDir, "case-study.md"), caseStudy, "utf-8");

  console.log("note/ブログ記事を生成中...");
  const article = await generateArticle(session, transcript);
  fs.writeFileSync(path.join(outDir, "article.md"), article, "utf-8");

  console.log(`\n生成完了: ${outDir}`);
  console.log("  - manual.md      (社内向け技術継承マニュアル)");
  console.log("  - case-study.md  (研修用ケーススタディ)");
  console.log("  - article.md     (note/ブログ用記事)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
