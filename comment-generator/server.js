// server.js
// 他の人のSNS投稿に対する返信コメント案を、Claude APIで自動生成するローカルWebアプリ。
// 生成された案はこの画面上でコピーするだけで、実際の投稿(送信)は必ず人間が手動で行う。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadHistory, saveHistory } = require("./lib/history");
const { generateComments } = require("./lib/generate");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = parseInt(process.env.PORT || "3000", 10);
// デフォルトはlocalhostのみ待受(意図せず外部公開されるのを防ぐため)
const HOST = process.env.HOST || "127.0.0.1";

const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("リクエストが大きすぎます"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function clip(str, max) {
  if (typeof str !== "string") return "";
  return str.slice(0, max);
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "POST" && url.pathname === "/api/generate") {
      if (!ANTHROPIC_API_KEY) {
        sendJson(res, 500, { error: "サーバーにANTHROPIC_API_KEYが設定されていません。" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const postText = clip(body.postText, 3000).trim();
      if (!postText) {
        sendJson(res, 400, { error: "postTextは必須です。" });
        return;
      }
      const params = {
        author: clip(body.author, 200).trim(),
        postText,
        postUrl: clip(body.postUrl, 500).trim(),
        tone: clip(body.tone, 1000).trim(),
        note: clip(body.note, 1000).trim(),
      };
      const history = loadHistory();
      const comments = await generateComments(params, history);
      sendJson(res, 200, { comments });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/history") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const comment = clip(body.comment, 500).trim();
      if (!comment) {
        sendJson(res, 400, { error: "commentは必須です。" });
        return;
      }
      const entry = {
        author: clip(body.author, 200).trim(),
        postText: clip(body.postText, 1000).trim(),
        postUrl: clip(body.postUrl, 500).trim(),
        comment,
        usedAt: new Date().toISOString(),
      };
      const history = loadHistory();
      history.push(entry);
      saveHistory(history);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/history") {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
      const history = loadHistory();
      sendJson(res, 200, { history: history.slice(-limit).reverse() });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, url.pathname);
      return;
    }

    res.writeHead(404);
    res.end();
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || "internal error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`コメント生成ツールを起動しました: http://${HOST}:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("警告: ANTHROPIC_API_KEY が設定されていません。/api/generate は失敗します。");
  }
});
