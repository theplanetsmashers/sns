#!/usr/bin/env node
'use strict';

// data/articles.json の各記事に、note.com (kotolog_note) で実際に公開された記事の
// URLをひもづける。note.com公開時にタイトルが書き換えられることが多いため、
// 本文テキストの重なり具合で照合する（タイトルの文字列一致は使わない）。
//
// 既に note.com の URL が入っている記事は URL の照合をスキップする（冪等）。
// Google Drive の URL のままの記事だけを対象に、新しく公開されたものがあれば
// note.com の URL に差し替える。まだ公開されていない記事は Drive の URL のまま
// 変更しない。note.com側の価格（price）と記事番号（本文中の「会社の裏設定 #NNN」の
// #NNN）は毎回上書きする（notePrice, noteNumber フィールド）。note.comの番号は
// Google Drive側のarticleNumberとズレることがあるため、表示にはnoteNumberを使う。

const fs = require('fs');
const path = require('path');

const NOTE_USERNAME = 'kotolog_note';
const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'articles.json');
const CHUNK_SKIP = 10;
const CHUNK_LEN = 50;

function isDriveUrl(url) {
  return typeof url === 'string' && /(?:drive|docs)\.google\.com/.test(url);
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\s+/g, '');
}

function toBigrams(text) {
  const grams = new Set();
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  return grams;
}

const NOTE_NUMBER_RE = /#0*(\d+)/;

function extractNoteNumber(name) {
  const m = NOTE_NUMBER_RE.exec(String(name || ''));
  return m ? Number(m[1]) : null;
}

function bigramScore(a, b) {
  const ga = toBigrams(a);
  const gb = toBigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  const [small, large] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
  for (const g of small) if (large.has(g)) shared++;
  return shared / Math.sqrt(ga.size * gb.size);
}

async function fetchAllNoteArticles(username) {
  const results = [];
  let page = 1;
  for (;;) {
    const res = await fetch(
      `https://note.com/api/v2/creators/${encodeURIComponent(username)}/contents?kind=note&page=${page}`
    );
    if (!res.ok) throw new Error(`note.com API error ${res.status} (page ${page})`);
    const json = await res.json();
    const data = json.data || {};
    const contents = data.contents || [];
    for (const c of contents) {
      results.push({ id: c.id, name: c.name, url: c.noteUrl, body: c.body || '', price: c.price || 0 });
    }
    if (data.isLastPage || contents.length === 0) break;
    page++;
    if (page > 200) break; // safety valve
  }
  return results;
}

function findMatch(driveBody, notePool) {
  const db = normalize(driveBody);
  if (!db) return -1;

  const candidates = [];
  for (let j = 0; j < notePool.length; j++) {
    const nb = notePool[j].normBody;
    if (!nb || nb.length < CHUNK_SKIP + 20) continue;
    const chunk = nb.slice(CHUNK_SKIP, CHUNK_SKIP + CHUNK_LEN);
    if (chunk.length >= 20 && db.includes(chunk)) candidates.push(j);
  }
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestScore = -1;
  for (const j of candidates) {
    const score = bigramScore(db.slice(0, 600), notePool[j].normBody.slice(0, 600));
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return best;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const articles = raw.articles || [];

  const usedNoteUrls = new Set(
    articles.map((a) => a.url).filter((u) => typeof u === 'string' && u.includes('note.com/'))
  );

  console.log(`fetching note.com articles for ${NOTE_USERNAME}...`);
  const noteArticles = await fetchAllNoteArticles(NOTE_USERNAME);
  console.log(`fetched ${noteArticles.length} published note.com articles`);

  const metaByUrl = new Map(
    noteArticles.map((a) => [a.url, { price: a.price, number: extractNoteNumber(a.name) }])
  );

  const notePool = noteArticles
    .filter((a) => !usedNoteUrls.has(a.url))
    .map((a) => ({ ...a, normBody: normalize(a.body) }));

  let updated = 0;
  const newlyMatched = [];

  for (const article of articles) {
    if (isDriveUrl(article.url)) {
      const idx = findMatch(article.body, notePool);
      if (idx === -1) continue;

      const match = notePool[idx];
      article.url = match.url;
      article.notePrice = match.price;
      article.noteNumber = extractNoteNumber(match.name);
      notePool.splice(idx, 1); // claim it, don't let another drive article reuse it
      updated++;
      newlyMatched.push({
        articleNumber: article.articleNumber,
        title: article.title,
        noteTitle: match.name,
        noteUrl: match.url,
      });
      continue;
    }

    // already on note.com: keep price and article number fresh
    if (article.url && article.url.includes('note.com/') && metaByUrl.has(article.url)) {
      const meta = metaByUrl.get(article.url);
      if (article.notePrice !== meta.price || article.noteNumber !== meta.number) {
        article.notePrice = meta.price;
        article.noteNumber = meta.number;
        updated++;
      }
    }
  }

  if (updated > 0) {
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  }

  console.log(`\nnewly matched: ${newlyMatched.length} (plus ${updated - newlyMatched.length} price refresh(es))`);
  for (const m of newlyMatched) {
    console.log(`  #${m.articleNumber} ${m.title} -> ${m.noteUrl}`);
  }

  const stillUnmatched = articles.filter((a) => isDriveUrl(a.url)).length;
  console.log(`\nstill on Google Drive (not yet published, or intentionally not published): ${stillUnmatched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
