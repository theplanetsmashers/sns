'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'articles.json');

let cache = null;

function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

// 日本語は分かち書きが無いため、形態素解析器を使わずに
// 2文字シングル（バイグラム）集合の重なり具合で類似度を測る。
function toBigrams(text) {
  const norm = normalize(text);
  const grams = new Set();
  for (let i = 0; i < norm.length - 1; i++) {
    grams.add(norm.slice(i, i + 2));
  }
  return grams;
}

function overlapScore(queryGrams, targetGrams) {
  if (queryGrams.size === 0 || targetGrams.size === 0) return 0;
  let shared = 0;
  const [smaller, larger] =
    queryGrams.size <= targetGrams.size ? [queryGrams, targetGrams] : [targetGrams, queryGrams];
  for (const g of smaller) {
    if (larger.has(g)) shared++;
  }
  return shared / Math.sqrt(queryGrams.size * targetGrams.size);
}

function load() {
  if (cache) return cache;

  if (!fs.existsSync(DATA_PATH)) {
    cache = { articles: [], indexed: [] };
    return cache;
  }

  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const allArticles = Array.isArray(raw.articles) ? raw.articles : [];
  // note.comで実際に公開されている記事だけを検索対象にする。Google Driveにしか
  // ない記事(未公開、または意図的に非公開の記事)は参照候補から除く。
  const articles = allArticles.filter(
    (a) => typeof a.url === 'string' && a.url.startsWith('https://note.com/')
  );

  const indexed = articles.map((article) => ({
    article,
    titleGrams: toBigrams(article.title),
    bodyGrams: toBigrams(`${article.title} ${article.body}`),
  }));

  cache = { articles, indexed, generatedAt: raw.generatedAt, source: raw.source };
  return cache;
}

function search(query, topK = 4) {
  const { indexed } = load();
  const queryGrams = toBigrams(query);

  if (queryGrams.size === 0 || indexed.length === 0) return [];

  const scored = indexed.map(({ article, titleGrams, bodyGrams }) => {
    const bodyScore = overlapScore(queryGrams, bodyGrams);
    const titleScore = overlapScore(queryGrams, titleGrams);
    // タイトル一致は文脈的に強いシグナルなので重みを上げる
    const score = bodyScore + titleScore * 1.5;
    return { article, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function stats() {
  const { articles, generatedAt, source } = load();
  return { count: articles.length, generatedAt, source };
}

function reload() {
  cache = null;
  return load();
}

module.exports = { search, stats, reload, DATA_PATH };
