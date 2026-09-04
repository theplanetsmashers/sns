#!/usr/bin/env node
'use strict';

// data/articles.json から、note.comで実際に公開されている記事だけを抜き出し、
// Artifact(裏設定相談室)に埋め込むための軽量なJSONを生成する。
// Google Driveにしかない記事(未公開、または意図的に非公開の記事)は含めない。

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'articles.json');
const OUT_PATH = path.join(__dirname, '..', 'dist', 'articles-data.json');

function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const articles = raw.articles || [];

  const published = articles
    .filter((a) => typeof a.url === 'string' && a.url.startsWith('https://note.com/'))
    .map((a) => ({
      id: a.id,
      title: a.title,
      // note.com側の記事番号(本文中の「会社の裏設定 #NNN」)を表示に使う。
      // Google Drive側のarticleNumberは下書き時点の番号で、公開時にズレることがある。
      n: a.noteNumber,
      url: a.url,
      body: a.body,
      paid: Boolean(a.notePrice) && a.notePrice > 0,
    }));

  const out = { generatedAt: new Date().toISOString(), articles: published };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8');

  console.log(`wrote ${published.length} published articles to ${OUT_PATH}`);
  console.log(`(${articles.length - published.length} Drive-only articles excluded)`);
}

main();
