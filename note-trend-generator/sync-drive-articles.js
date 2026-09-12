// sync-drive-articles.js
// Google Driveのnote記事フォルダを見に行き、新しく書かれた記事を
// state/published-articles.json に追記するスクリプト。
// GitHub Actionsで日次実行される想定(Googleサービスアカウントを使用)。
// これにより、note-trend-generatorのネタ提案が「すでに書いた記事」と
// 重複しないようになる。

const fs = require("fs");
const path = require("path");
const { getAccessToken } = require("./lib/googleServiceAuth");
const { listFolderFiles, getFileText } = require("./lib/driveApi");

const DRIVE_NOTE_FOLDER_ID = process.env.DRIVE_NOTE_FOLDER_ID;
const PUBLISHED_PATH = path.join(__dirname, "state", "published-articles.json");

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// ファイル名が「NNN_タイトル.md」形式ならそこから番号・タイトルを取り出す
function extractFromFilename(name) {
  const m = name.match(/^(\d+)_(.+)\.md$/);
  if (!m) return null;
  return { number: m[1], title: m[2] };
}

// ファイル名から取れない場合のフォールバック。本文1行目の見出し
// (例:「# タイトル 会社の裏設定 #215」)からタイトル・番号を取り出す
function extractFromContent(text) {
  const firstLine = (text.split("\n")[0] || "").replace(/\\#/g, "#").replace(/^#+\s*/, "").trim();
  const m = firstLine.match(/^(.+?)\s*会社の裏設定\s*#(\d+)\s*$/);
  if (m) return { title: m[1].trim(), number: m[2] };
  return { title: firstLine || null, number: null };
}

function sortByNumber(entries) {
  return [...entries].sort((a, b) => {
    const na = parseInt(a.number, 10);
    const nb = parseInt(b.number, 10);
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  });
}

async function main() {
  if (!DRIVE_NOTE_FOLDER_ID) {
    throw new Error("DRIVE_NOTE_FOLDER_ID が設定されていません。");
  }

  const published = loadJson(PUBLISHED_PATH, []);
  const knownIds = new Set(published.map((p) => p.driveFileId));

  const accessToken = await getAccessToken();
  const files = await listFolderFiles(accessToken, DRIVE_NOTE_FOLDER_ID);

  const candidates = files.filter(
    (f) => f.name.endsWith(".md") && !f.name.includes("見出し画像プロンプト") && !knownIds.has(f.id)
  );

  if (candidates.length === 0) {
    console.log("新しいnote記事はありませんでした。");
    return;
  }

  const newEntries = [];
  for (const f of candidates) {
    let parsed = extractFromFilename(f.name);
    if (!parsed || !parsed.title) {
      console.log(`  ファイル名から抽出できないため本文を確認します: ${f.name}`);
      const text = await getFileText(accessToken, f.id);
      parsed = extractFromContent(text);
    }
    const entry = {
      number: parsed?.number || null,
      title: parsed?.title || f.name,
      driveFileId: f.id,
      createdAt: f.createdTime,
    };
    newEntries.push(entry);
    console.log(`  新規記事を検出: #${entry.number || "?"} ${entry.title}`);
  }

  const merged = sortByNumber([...published, ...newEntries]);
  fs.writeFileSync(PUBLISHED_PATH, JSON.stringify(merged, null, 2));
  console.log(`${newEntries.length}件のnote記事を同期しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
