#!/usr/bin/env node
'use strict';

// artifact/template.html (プレースホルダ __ARTICLES_DATA_JSON__ を含む) と
// dist/articles-data.json (build-artifact-data.js の出力) を合成して、
// Artifactとして公開できる単一のHTMLファイルを dist/ に書き出す。

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'artifact', 'template.html');
const DATA_PATH = path.join(__dirname, '..', 'dist', 'articles-data.json');
const OUT_PATH = path.join(__dirname, '..', 'dist', 'urasettei-artifact.html');
const PLACEHOLDER = '__ARTICLES_DATA_JSON__';

function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const dataJson = fs.readFileSync(DATA_PATH, 'utf8');

  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`template is missing ${PLACEHOLDER}`);
  }
  if (dataJson.includes('</script>')) {
    throw new Error('articles-data.json unexpectedly contains "</script>"');
  }

  const html = template.replace(PLACEHOLDER, dataJson);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html, 'utf8');

  console.log(`wrote ${OUT_PATH} (${html.length} chars)`);
}

main();
