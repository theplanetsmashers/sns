// generate-outputs.js
// interview.js が保存したセッションJSONを読み込み、以下3種類のアウトプットを
// Claude APIで生成してMarkdownファイルに書き出すスクリプト。
//   1. 社内向け技術継承マニュアル(PFMEA的な留意点込み、ハルシネーション検査つき二段階生成)
//   2. 研修用ケーススタディ(判断プロセスを追体験できる形式)
//   3. note/ブログ用の一般公開記事
// 生成後、設定されていればDiscord/Slackへの通知とGoogle Driveへのアップロードも行う。
//
// 使い方:
//   node generate-outputs.js sessions/xxxx.json            通常(Claude APIで生成)
//   node generate-outputs.js sessions/xxxx.json --dry-run  Claude APIを呼ばず構造だけのプレースホルダーを無料生成
//   node generate-outputs.js sessions/xxxx.json --real     ドライランで作ったセッションでも強制的にAPIで生成

const fs = require("fs");
const path = require("path");
const engine = require("./lib/interview-engine");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const OUTPUTS_DIR = path.join(__dirname, "outputs");

function buildTranscript(session) {
  return session.records
    .map((r) => {
      const parts = [`【${r.category}】`, `Q: ${r.question}`, `A: ${r.answer}`];
      if (r.followup_question) {
        parts.push(`深掘りQ: ${r.followup_question}`);
        parts.push(`深掘りA: ${r.followup_answer}`);
      }
      parts.push(`要約: ${r.summary}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

async function generateManualDraft(session, transcript) {
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
  return engine.callClaude(prompt, 2500);
}

// 二段階生成のレビュー段階: ドラフトがインタビュー記録に基づかない事実を
// 「本人の発言であるかのように」追加(ハルシネーション)していないかを別呼び出しで検査させる
async function reviewManual(session, transcript, draft) {
  const prompt = `あなたは技術文書のレビュアーです。以下の「インタビュー記録原文」と、それを元に生成された「マニュアルのドラフト」を比較してください。

【チェック項目】
- ドラフト中に、インタビュー記録に書かれていない具体的な数値・手順・固有名詞が、あたかも本人の発言のように追加されていないか
- PFMEAの失敗モード表に、記録から読み取れない失敗モードが「事実」として断定的に書かれていないか(一般的な注意点として書く場合は問題ないが、その旨を明示すべき)

問題があれば、該当箇所を「インタビュー記録に基づく内容」と「一般的な注意点として補足した内容」が区別できるように修正してください。問題がなければドラフトをそのまま出力してください。

出力は必ずマニュアルの最終版Markdown全文のみ。レビューコメントや前置きは含めないでください。

【インタビュー記録原文】
${transcript}

【マニュアルのドラフト】
${draft}`;
  return engine.callClaude(prompt, 2500);
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
  return engine.callClaude(prompt, 2500);
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
  return engine.callClaude(prompt, 3000);
}

// Claude APIを呼ばない「ドライラン」用の簡易プレースホルダー生成。
// 本物の文章化はできないが、フォルダ構成・同意ゲート・ダッシュボード連携など
// パイプライン全体を無料で試すためのもの。
function buildOfflinePreview(session, label) {
  const lines = [
    `> ⚠️ ドライランモードのプレースホルダーです。実際の${label}を生成するには、ANTHROPIC_API_KEYを設定して(このセッションが --dry-run 作成なら --real を付けて)再実行してください。`,
    "",
    `# ${session.topic}(${label}・ドライラン版)`,
    `対象者: ${session.interviewee} / 部署: ${session.department || "未設定"}`,
    "",
  ];
  for (const r of session.records) {
    lines.push(`## ${r.category}(濃さ ${r.richness_score}/5)`);
    lines.push(`- 質問: ${r.question}`);
    lines.push(`- 回答: ${r.answer}`);
    if (r.followup_question) {
      lines.push(`- 深掘り質問: ${r.followup_question}`);
      lines.push(`- 深掘り回答: ${r.followup_answer}`);
    }
    lines.push(`- 要約: ${r.summary}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function notifyDiscord(session, generated) {
  if (!DISCORD_WEBHOOK_URL) return;
  const lines = [
    `📚 インタビューからアウトプットを生成しました`,
    `対象者: ${session.interviewee} / テーマ: ${session.topic}`,
    ...generated.map((g) => `・${g}`),
  ];
  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: lines.join("\n") }),
  });
}

async function notifySlack(session, generated) {
  if (!SLACK_WEBHOOK_URL) return;
  const lines = [
    `📚 インタビューからアウトプットを生成しました`,
    `対象者: ${session.interviewee} / テーマ: ${session.topic}`,
    ...generated.map((g) => `・${g}`),
  ];
  await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
}

async function uploadToDriveIfConfigured(sessionPath, session, outDir) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) return;
  console.log("Google Driveへアップロード中...");
  const { uploadSessionOutputs } = require("./lib/google-drive");
  await uploadSessionOutputs(sessionPath, session, outDir);
  console.log("Google Driveへのアップロードが完了しました。");
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
  const consent = session.consent || { internal: false, public: false };

  if (!consent.internal) {
    console.log(
      "このセッションは社内利用への同意が記録されていないため、アウトプット生成を中止します。"
    );
    return;
  }

  const cliArgs = process.argv.slice(3);
  const forceReal = cliArgs.includes("--real");
  const dryRun = cliArgs.includes("--dry-run") || (!!session.dry_run && !forceReal);

  if (dryRun) {
    console.log("🔧 ドライランモード: Claude APIを呼ばず、構造だけのプレースホルダーを生成します(無料)。");
  }

  const transcript = buildTranscript(session);

  const baseName = path.basename(sessionPath, ".json");
  const outDir = path.join(OUTPUTS_DIR, baseName);
  fs.mkdirSync(outDir, { recursive: true });

  const generated = [];

  if (dryRun) {
    const manual = buildOfflinePreview(session, "社内向け技術継承マニュアル");
    fs.writeFileSync(path.join(outDir, "manual.md"), manual, "utf-8");
    generated.push("manual.md      (社内向け技術継承マニュアル / ドライラン版)");
  } else {
    console.log("マニュアルのドラフトを生成中...");
    const manualDraft = await generateManualDraft(session, transcript);
    console.log("マニュアルをレビュー中(記録にない記述の混入チェック)...");
    const manualFinal = await reviewManual(session, transcript, manualDraft);
    fs.writeFileSync(path.join(outDir, "manual.draft.md"), manualDraft, "utf-8");
    fs.writeFileSync(path.join(outDir, "manual.md"), manualFinal, "utf-8");
    generated.push("manual.md      (社内向け技術継承マニュアル / レビュー済み)");
  }

  if (dryRun) {
    const caseStudy = buildOfflinePreview(session, "研修用ケーススタディ");
    fs.writeFileSync(path.join(outDir, "case-study.md"), caseStudy, "utf-8");
    generated.push("case-study.md  (研修用ケーススタディ / ドライラン版)");
  } else {
    console.log("研修用ケーススタディを生成中...");
    const caseStudy = await generateCaseStudy(session, transcript);
    fs.writeFileSync(path.join(outDir, "case-study.md"), caseStudy, "utf-8");
    generated.push("case-study.md  (研修用ケーススタディ)");
  }

  if (consent.public) {
    if (dryRun) {
      const article = buildOfflinePreview(session, "note/ブログ用記事");
      fs.writeFileSync(path.join(outDir, "article.md"), article, "utf-8");
      generated.push("article.md     (note/ブログ用記事 / ドライラン版)");
    } else {
      console.log("note/ブログ記事を生成中...");
      const article = await generateArticle(session, transcript);
      fs.writeFileSync(path.join(outDir, "article.md"), article, "utf-8");
      generated.push("article.md     (note/ブログ用記事)");
    }
  } else {
    console.log("社外公開への同意がないため、note/ブログ記事の生成はスキップします。");
  }

  console.log(`\n生成完了: ${outDir}`);
  for (const g of generated) console.log(`  - ${g}`);

  await notifyDiscord(session, generated);
  await notifySlack(session, generated);
  await uploadToDriveIfConfigured(sessionPath, session, outDir);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildTranscript };
