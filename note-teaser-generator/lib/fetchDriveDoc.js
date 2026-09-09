// lib/fetchDriveDoc.js
// Google Docsの共有リンクから本文を取得する。
// 「リンクを知っている全員が閲覧可」に設定されたドキュメントは、認証なしでプレーンテキストの
// エクスポートを取得できる。非公開ドキュメントの場合や取得に失敗した場合はnullを返し、
// 呼び出し側は本文の直接貼り付け(Issueのテキスト欄)にフォールバックする。

function extractDocId(url) {
  if (!url) return null;
  const str = String(url).trim();
  const m = str.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // IDそのものが渡された場合
  if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) return str;
  return null;
}

async function fetchDriveDocText(url) {
  const docId = extractDocId(url);
  if (!docId) return null;

  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(exportUrl, { redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const text = await res.text();
    // 非公開ドキュメントの場合、Googleのログイン誘導HTMLが返ってくることがあるため簡易チェックする
    if (!text || /<html/i.test(text.slice(0, 200))) return null;
    return text.trim() || null;
  } catch {
    return null;
  }
}

module.exports = { fetchDriveDocText, extractDocId };
