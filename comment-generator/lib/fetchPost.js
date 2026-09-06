// lib/fetchPost.js
// 投稿URLからOGP(og:title / og:description)を取得して、本文の自動取得を試みる。
// Threads等はログインなしでは本文を返さない場合があるため、あくまでベストエフォート。
// 取得できない場合はnullを返し、呼び出し側は本文の手動入力にフォールバックする。

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function extractMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return null;
}

async function fetchOgMetadata(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CommentDraftBot/1.0)",
        "Accept-Language": "ja,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const html = await res.text();
    const description = extractMeta(html, "og:description");
    const title = extractMeta(html, "og:title");
    if (!description && !title) return null;
    return { title, description };
  } catch {
    return null;
  }
}

module.exports = { fetchOgMetadata };
