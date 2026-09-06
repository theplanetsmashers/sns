// server.js
// 他の人のSNS投稿に対する返信コメント案を、Claude APIで自動生成するローカルWebアプリ。
// 生成された案はこの画面上でコピーするだけで、実際の投稿(送信)は必ず人間が手動で行う。

const http = require("http");
const fs = require("fs");
const path = require("path");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = parseInt(process.env.PORT || "3000", 10);
// デフォルトはlocalhostのみ待受(意図せず外部公開されるのを防ぐため)
const HOST = process.env.HOST || "127.0.0.1";

const PUBLIC_DIR = path.join(__dirname, "public");
const HISTORY_PATH = path.join(__dirname, "state", "history.json");
const MAX_HISTORY = 200;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  const trimmed = history.slice(-MAX_HISTORY);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2), "utf-8");
}

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

function buildAvoidSummary(history) {
  const recent = history.slice(-15).map((h) => h.comment);
  if (recent.length === 0) return "(まだ履歴はありません)";
  return recent.map((c) => `・${c}`).join("\n");
}

async function generateComments({ author, postText, postUrl, tone, note }, history) {
  const avoidSummary = buildAvoidSummary(history);

  const prompt = `あなたはThreadsやSNSで、他の人の投稿に返信コメントを書くのを手伝うアシスタントです。
以下の投稿に対して、自然で気取らない返信コメントを3パターン作成してください。

【コメントするアカウントの普段のトーン】
${tone || "共感ベースで、上から目線にならない自然体。絵文字は使っても0〜1個程度。"}

【コメント対象の投稿】
投稿者: ${author || "(不明)"}
投稿内容:
${postText}

${note ? `【追加の指示・文脈】\n${note}\n` : ""}
【直近で使ったコメント文(似た言い回しの繰り返しを避けること)】
${avoidSummary}

【コメントの条件】
- 日本語で100文字以内、1〜2文
- 説教や上から目線にならない。共感・驚き・自分ごと化・具体的な問いかけなど、視点を交える
- 3パターンはそれぞれ違うアプローチにする(例: 共感型、質問型、気づき共有型)
- そのままコピペしてすぐ使える自然な文章にする
- Markdown記号(#や*など)は使わない

出力は次のJSON形式の配列のみ。前置きや説明、コードブロックは一切つけないこと。
["コメント案1", "コメント案2", "コメント案3"]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const raw = textBlock ? textBlock.text.trim() : "[]";

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((s) => String(s).trim()).filter(Boolean);
    }
  } catch {
    // JSONとして読めなかった場合は行分割にフォールバック
  }
  return raw
    .split("\n")
    .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
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
