'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { search, stats } = require('./lib/retrieval');
const { generateAdvice } = require('./lib/advice');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(req, res) {
  let requestPath = req.url === '/' ? '/index.html' : req.url;
  requestPath = requestPath.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, requestPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleAdvice(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: '不正なリクエストです。' });
  }

  const concern = String(body.concern || '').trim();
  if (!concern) {
    return sendJson(res, 400, { error: '悩みの内容を入力してください。' });
  }
  if (concern.length > 4000) {
    return sendJson(res, 400, { error: '入力が長すぎます（4000文字以内にしてください）。' });
  }

  const matches = search(concern, 4);

  if (matches.length === 0) {
    return sendJson(res, 200, {
      mode: 'no_match',
      advice: null,
      references: [],
      message:
        '関連しそうな記事が見つかりませんでした。表現を変えるか、もう少し具体的に状況を書いてみてください。',
    });
  }

  const references = matches.map((m) => ({
    title: m.article.title,
    // note.com側の記事番号を表示に使う（Google Drive側のarticleNumberとはズレることがある）
    articleNumber: m.article.noteNumber,
    url: m.article.url,
    paid: Boolean(m.article.notePrice) && m.article.notePrice > 0,
    score: Number(m.score.toFixed(3)),
  }));

  try {
    const result = await generateAdvice(concern, matches);

    if (result.mode === 'fallback') {
      return sendJson(res, 200, {
        mode: 'fallback',
        advice: null,
        references,
        message:
          'ANTHROPIC_API_KEY が設定されていないため、AIによるアドバイス生成はできません。' +
          '関連しそうな記事だけを下に表示します。.env に ANTHROPIC_API_KEY を設定すると、' +
          'これらの記事を踏まえた具体的なアドバイス文が生成されます。',
      });
    }

    return sendJson(res, 200, {
      mode: 'llm',
      advice: result.text,
      references,
    });
  } catch (err) {
    console.error(err);
    return sendJson(res, 502, {
      error: 'アドバイス生成中にエラーが発生しました。しばらくしてから再度お試しください。',
      detail: String(err.message || err),
      references,
    });
  }
}

function handleStatus(req, res) {
  const s = stats();
  sendJson(res, 200, {
    articleCount: s.count,
    dataGeneratedAt: s.generatedAt || null,
    source: s.source || null,
    llmEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/advice') {
    return void handleAdvice(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    return void handleStatus(req, res);
  }
  if (req.method === 'GET') {
    return void serveStatic(req, res);
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  const s = stats();
  console.log(`advice-app listening on http://localhost:${PORT}`);
  console.log(`記事データ: ${s.count}件 (${s.source || 'データ未読み込み'})`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('注意: ANTHROPIC_API_KEY が未設定のため、AIアドバイス生成は無効です。');
  }
});
