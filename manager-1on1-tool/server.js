// server.js
// 新任管理職向け1on1支援ツール。ローカルWebアプリ。
// 部下プロフィール管理、1on1前のアジェンダ提案、1on1後の記録・要点抽出、
// 複数回のログからの傾向サマリーをClaude APIで支援する。

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  loadSubordinates,
  saveSubordinates,
  loadLogs,
  saveLogs,
  logsForSubordinate,
} = require("./lib/store");
const { generateAgenda, summarizeLog, generateTrend } = require("./lib/generate");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = parseInt(process.env.PORT || "3100", 10);
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

function findSubordinate(subordinates, id) {
  return subordinates.find((s) => s.id === id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // 部下プロフィール一覧
    if (req.method === "GET" && url.pathname === "/api/subordinates") {
      sendJson(res, 200, { subordinates: loadSubordinates() });
      return;
    }

    // 部下プロフィール登録
    if (req.method === "POST" && url.pathname === "/api/subordinates") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const name = clip(body.name, 100).trim();
      if (!name) {
        sendJson(res, 400, { error: "nameは必須です。" });
        return;
      }
      const type = body.type === "delegate" ? "delegate" : "direct";
      const entry = {
        id: crypto.randomUUID(),
        name,
        role: clip(body.role, 200).trim(),
        experienceYears: clip(String(body.experienceYears ?? ""), 20).trim(),
        type,
        note: clip(body.note, 1000).trim(),
        createdAt: new Date().toISOString(),
      };
      const subordinates = loadSubordinates();
      subordinates.push(entry);
      saveSubordinates(subordinates);
      sendJson(res, 200, { subordinate: entry });
      return;
    }

    // 部下プロフィール削除
    if (req.method === "DELETE" && url.pathname.startsWith("/api/subordinates/")) {
      const id = url.pathname.split("/").pop();
      const subordinates = loadSubordinates().filter((s) => s.id !== id);
      saveSubordinates(subordinates);
      sendJson(res, 200, { ok: true });
      return;
    }

    // 1on1前: アジェンダ生成
    if (req.method === "POST" && url.pathname === "/api/agenda") {
      if (!ANTHROPIC_API_KEY) {
        sendJson(res, 500, { error: "サーバーにANTHROPIC_API_KEYが設定されていません。" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const subordinateId = clip(body.subordinateId, 100).trim();
      const subordinate = findSubordinate(loadSubordinates(), subordinateId);
      if (!subordinate) {
        sendJson(res, 400, { error: "指定された部下が見つかりません。" });
        return;
      }
      const recentStatus = clip(body.recentStatus, 3000).trim();
      const logs = logsForSubordinate(loadLogs(), subordinateId);
      const agenda = await generateAgenda({ subordinate, recentStatus, logs });
      sendJson(res, 200, { agenda });
      return;
    }

    // 1on1後: メモから要点抽出して記録
    if (req.method === "POST" && url.pathname === "/api/logs") {
      if (!ANTHROPIC_API_KEY) {
        sendJson(res, 500, { error: "サーバーにANTHROPIC_API_KEYが設定されていません。" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const subordinateId = clip(body.subordinateId, 100).trim();
      const subordinate = findSubordinate(loadSubordinates(), subordinateId);
      if (!subordinate) {
        sendJson(res, 400, { error: "指定された部下が見つかりません。" });
        return;
      }
      const memo = clip(body.memo, 5000).trim();
      if (!memo) {
        sendJson(res, 400, { error: "memoは必須です。" });
        return;
      }
      const allLogs = loadLogs();
      const pastLogs = logsForSubordinate(allLogs, subordinateId);
      const summary = await summarizeLog({ subordinate, memo, logs: pastLogs });
      const entry = {
        id: crypto.randomUUID(),
        subordinateId,
        date: clip(body.date, 20).trim() || new Date().toISOString().slice(0, 10),
        memo,
        summary,
        createdAt: new Date().toISOString(),
      };
      allLogs.push(entry);
      saveLogs(allLogs);
      sendJson(res, 200, { log: entry });
      return;
    }

    // 部下ごとのログ一覧
    if (req.method === "GET" && url.pathname === "/api/logs") {
      const subordinateId = url.searchParams.get("subordinateId") || "";
      const logs = logsForSubordinate(loadLogs(), subordinateId).slice().reverse();
      sendJson(res, 200, { logs });
      return;
    }

    // 複数回のログから傾向サマリーを生成
    if (req.method === "POST" && url.pathname === "/api/trend") {
      if (!ANTHROPIC_API_KEY) {
        sendJson(res, 500, { error: "サーバーにANTHROPIC_API_KEYが設定されていません。" });
        return;
      }
      const body = JSON.parse((await readBody(req)) || "{}");
      const subordinateId = clip(body.subordinateId, 100).trim();
      const subordinate = findSubordinate(loadSubordinates(), subordinateId);
      if (!subordinate) {
        sendJson(res, 400, { error: "指定された部下が見つかりません。" });
        return;
      }
      const logs = logsForSubordinate(loadLogs(), subordinateId);
      const trend = await generateTrend({ subordinate, logs });
      sendJson(res, 200, { trend });
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
  console.log(`1on1支援ツールを起動しました: http://${HOST}:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("警告: ANTHROPIC_API_KEY が設定されていません。生成系APIは失敗します。");
  }
});
