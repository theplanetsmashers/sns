#!/usr/bin/env node
'use strict';

// data/articles.json から、note.comで公開済み・かつ英語メタデータ(titleEn/summaryEn/
// keywordsEn)が入っている記事だけを抜き出し、英語版サイト(hidden-rules-en)に埋め込む
// ための軽量なJSONを生成する。英語メタデータが無い記事(翻訳がまだ済んでいない新規記事)
// は含めない。

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'articles.json');
const OUT_PATH = path.join(__dirname, '..', 'dist', 'en-records-data.json');

function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const articles = raw.articles || [];

  const translated = articles.filter(
    (a) =>
      typeof a.url === 'string' &&
      a.url.startsWith('https://note.com/') &&
      a.titleEn &&
      a.summaryEn
  );

  const records = translated.map((a) => ({
    id: a.id,
    n: a.noteNumber,
    titleEn: a.titleEn,
    summaryEn: a.summaryEn,
    keywordsEn: a.keywordsEn || [],
    url: a.url,
    paid: Boolean(a.notePrice) && a.notePrice > 0,
  }));

  const out = { generatedAt: new Date().toISOString(), records };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8');

  const untranslated = articles.filter(
    (a) => typeof a.url === 'string' && a.url.startsWith('https://note.com/') && (!a.titleEn || !a.summaryEn)
  ).length;

  console.log(`wrote ${records.length} translated records to ${OUT_PATH}`);
  if (untranslated > 0) {
    console.log(`(${untranslated} published articles still need English metadata — see README)`);
  }
}

main();
