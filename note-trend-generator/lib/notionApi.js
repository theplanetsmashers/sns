// lib/notionApi.js
// Notion API(Internal Integration Token)への薄いラッパー。
// 指定したデータベースの全ページを取得する。

const NOTION_VERSION = "2022-06-28";
const NOTION_API_BASE = "https://api.notion.com/v1";

async function queryDatabasePages(token, databaseId) {
  const results = [];
  let startCursor;

  do {
    const response = await fetch(`${NOTION_API_BASE}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Notion APIデータベース取得エラー: ${response.status} ${errText}`);
    }

    const data = await response.json();
    results.push(...data.results);
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return results;
}

// Notionのプロパティ値から扱いやすい形(文字列・数値等)を取り出す
function getPlainText(property) {
  const richText = property?.title || property?.rich_text || [];
  return richText.map((t) => t.plain_text).join("").trim();
}

function getNumber(property) {
  return typeof property?.number === "number" ? property.number : null;
}

function getSelectName(property) {
  return property?.select?.name || null;
}

function getDateStart(property) {
  return property?.date?.start || null;
}

module.exports = { queryDatabasePages, getPlainText, getNumber, getSelectName, getDateStart };
