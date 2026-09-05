// list-sessions.js
// sessions/ 配下のインタビュー記録を一覧表示するユーティリティ。
// 進行状況(何問中何問回答済みか)・同意状況をひと目で確認できる。
//
// 使い方: node list-sessions.js

const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(__dirname, "sessions");
const TEMPLATES_DIR = path.join(__dirname, "templates");

function templateLength(templateName) {
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.json`);
  if (!fs.existsSync(filePath)) return "?";
  return JSON.parse(fs.readFileSync(filePath, "utf-8")).length;
}

function main() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log("sessions/ ディレクトリがありません。");
    return;
  }

  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("インタビュー記録はまだありません。");
    return;
  }

  for (const file of files.sort()) {
    const filePath = path.join(SESSIONS_DIR, file);
    const session = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const total = templateLength(session.template);
    const answered = session.records.length;
    const status = total !== "?" && answered >= total ? "完了" : "進行中";
    const consent = session.consent || { internal: false, public: false };
    console.log(
      `- ${file}\n` +
        `    対象者: ${session.interviewee} / テーマ: ${session.topic}\n` +
        `    テンプレート: ${session.template} / 進捗: ${answered}/${total} (${status})\n` +
        `    同意: 社内=${consent.internal ? "○" : "×"} 公開=${consent.public ? "○" : "×"}`
    );
  }
}

main();
