// lib/searchNote.js
// note.comの検索結果ページをヘッドレスブラウザで開き、記事タイトル・URLを取得する。
// note.comは検索結果をクライアントサイドで描画するため、単純なfetchでは中身が取得できない
// (og:title等のOGPも検索結果ページ自体には無いため、fetchPost.js方式は使えない)。
// DOM構造の変更やbot対策で取得できなくなることがあるため、失敗時は例外を投げず
// 空配列を返す。呼び出し側はそのキーワードだけスキップして処理を続ける。

const NOTE_ARTICLE_URL_RE = /^https:\/\/note\.com\/[^/]+\/n\/[a-z0-9]+/i;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function searchNoteArticles(browser, query, { limit = 10, timeoutMs = 20000 } = {}) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja,en;q=0.8" });

    const searchUrl = `https://note.com/search?context=note&q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: timeoutMs });

    try {
      await page.waitForSelector('a[href*="/n/"]', { timeout: timeoutMs });
    } catch {
      return [];
    }

    const rawResults = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/n/"]'));
      return anchors.map((a) => ({ href: a.href, text: (a.innerText || "").trim() }));
    });

    const seen = new Set();
    const results = [];
    for (const { href, text } of rawResults) {
      if (!NOTE_ARTICLE_URL_RE.test(href) || !text) continue;
      const cleanHref = href.split("?")[0];
      if (seen.has(cleanHref)) continue;
      seen.add(cleanHref);
      const title = text.split("\n")[0].slice(0, 120);
      if (!title) continue;
      results.push({ title, url: cleanHref });
      if (results.length >= limit) break;
    }
    return results;
  } catch (err) {
    console.warn(`  note検索に失敗しました(${query}): ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

module.exports = { searchNoteArticles };
