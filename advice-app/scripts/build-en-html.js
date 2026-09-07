#!/usr/bin/env node
'use strict';

// hidden-rules-en/template.html (プレースホルダ __EN_RECORDS_DATA_JSON__ を含む) と
// dist/en-records-data.json (build-en-data.js の出力) を合成して、Artifactとして
// 公開できる単一のHTMLファイルを hidden-rules-en/dist/ に書き出す。

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'hidden-rules-en', 'template.html');
const DATA_PATH = path.join(__dirname, '..', 'dist', 'en-records-data.json');
const OUT_PATH = path.join(__dirname, '..', '..', 'hidden-rules-en', 'dist', 'hidden-rules-en.html');
const PLACEHOLDER = '__EN_RECORDS_DATA_JSON__';

function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const dataJson = fs.readFileSync(DATA_PATH, 'utf8');

  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`template is missing ${PLACEHOLDER}`);
  }
  if (dataJson.includes('</script>')) {
    throw new Error('en-records-data.json unexpectedly contains "</script>"');
  }

  const html = template.replace(PLACEHOLDER, dataJson);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html, 'utf8');

  console.log(`wrote ${OUT_PATH} (${html.length} chars)`);
}

main();
