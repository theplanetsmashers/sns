// sync-notion-articles.js
// Notionの note記事DB(会社の裏設定) を見に行き、登録されている記事一覧を
// state/published-articles.json に書き出すスクリプト。
// GitHub Actionsで定期実行される想定(Notion Internal Integrationトークンを使用)。
// これにより、note-trend-generatorのネタ提案が「すでに書いた記事」と
// 重複しないようになる。
//
// sync-drive-articles.js(Google Drive由来)との違い:
// 今後の新規記事はNotionのDBに直接追加していく運用のため、こちらは
// 差分追記ではなく、Notion側の内容で published-articles.json を毎回まるごと
// 置き換える(Notionを一次情報源として扱う)。

const fs = require("fs");
const path = require("path");
const { queryDatabasePages, getPlainText, getNumber, getSelectName, getDateStart } = require("./lib/notionApi");

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const PUBLISHED_PATH = path.join(__dirname, "state", "published-articles.json");

// Notion側のタイトルは「本文タイトル|会社の裏設定 #NNN」の形式で保存されているため、
// "|" 以降(連載名・番号部分)を取り除いて記事本来のタイトルだけを取り出す
function extractTitle(nameProperty) {
  const full = getPlainText(nameProperty);
  return full.split("|")[0].trim();
}

function sortByNumber(entries) {
  return [...entries].sort((a, b) => {
    const na = typeof a.number === "number" ? a.number : Number.parseInt(a.number, 10);
    const nb = typeof b.number === "number" ? b.number : Number.parseInt(b.number, 10);
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  });
}

async function main() {
  if (!NOTION_API_KEY) {
    throw new Error("NOTION_API_KEY が設定されていません。");
  }
  if (!NOTION_DATABASE_ID) {
    throw new Error("NOTION_DATABASE_ID が設定されていません。");
  }

  const pages = await queryDatabasePages(NOTION_API_KEY, NOTION_DATABASE_ID);

  const entries = pages.map((page) => {
    const props = page.properties;
    return {
      number: getNumber(props["番号"]),
      title: extractTitle(props["Name"]),
      status: getSelectName(props["ステータス"]),
      notionPageId: page.id,
      createdAt: getDateStart(props["作成日"]) || page.created_time,
    };
  });

  const sorted = sortByNumber(entries);
  fs.writeFileSync(PUBLISHED_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Notionから${sorted.length}件のnote記事を同期しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
