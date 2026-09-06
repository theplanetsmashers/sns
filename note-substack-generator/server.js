// server.js
// note記事を貼り付けると、Substack用の英語導入記事をClaude APIで自動生成するローカルWebアプリ。
// 生成された記事はこの画面上でコピーするだけで、実際のSubstackへの投稿は必ず人間が手動で行う。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { generateIntro } = require("./lib/generate");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = parseInt(process.env.PORT || "3001", 10);
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
      if (data.length > 2_000_000) {
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
      const articleText = clip(body.articleText, 40000).trim();
      if (!articleText) {
        sendJson(res, 400, { error: "articleTextは必須です。" });
        return;
      }
      const params = {
        articleText,
        articleUrl: clip(body.articleUrl, 500).trim(),
        tone: clip(body.tone, 1000).trim(),
        note: clip(body.note, 1000).trim(),
      };
      const article = await generateIntro(params);
      sendJson(res, 200, { article });
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
  console.log(`note→Substack導入記事生成ツールを起動しました: http://${HOST}:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("警告: ANTHROPIC_API_KEY が設定されていません。/api/generate は失敗します。");
  }
});
