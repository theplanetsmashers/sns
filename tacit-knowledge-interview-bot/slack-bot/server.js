// slack-bot/server.js
// 暗黙知インタビューボットをSlack上で使うための最小サーバー。
// Slackのスラッシュコマンド(/interview)でインタビューを開始し、以降はBotとのDMで
// 質問→回答→深掘り→要約のやり取りを行う(ロジックは slack-bot/conversation.js に集約、
// CLI版と lib/interview-engine.js を共有)。
//
// 事前準備(Slack API管理画面 https://api.slack.com/apps で行う):
//   1. Botアプリを作成し、Bot Token Scopes に chat:write, im:history, im:write, users:read を追加
//   2. Slash Command `/interview` を作成し、Request URL を https://<このサーバー>/slack/commands に設定
//   3. Event Subscriptions を有効化し、Request URL を https://<このサーバー>/slack/events に設定
//      (最初はURL検証チャレンジに自動応答するので、そのまま検証が通る)
//      Subscribe to bot events に message.im を追加
//   4. アプリをワークスペースにインストールし、Bot User OAuth Token (xoxb-...) を取得
//
// 必要な環境変数:
//   SLACK_BOT_TOKEN        Bot User OAuth Token (xoxb-...)
//   SLACK_SIGNING_SECRET   Basic Information ページの Signing Secret
//   ANTHROPIC_API_KEY      lib/interview-engine.js が使用
//   PORT                   任意。デフォルト3000
//
// 使い方: node slack-bot/server.js
// (このサーバーは常時稼働させ、ngrokや実際のホスティング環境等で外部公開する必要がある)

const http = require("http");
const slack = require("./slack-client");
const conversation = require("./conversation");

const PORT = process.env.PORT || 3000;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseFormEncoded(body) {
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function handleSlashCommand(req, res, rawBody) {
  const payload = parseFormEncoded(rawBody);

  if (payload.command !== "/interview") {
    return sendJson(res, 200, { response_type: "ephemeral", text: "未対応のコマンドです。" });
  }

  const userId = payload.user_id;
  const text = (payload.text || "").trim();

  if (text === "cancel") {
    conversation.cancelSession(userId);
    return sendJson(res, 200, { response_type: "ephemeral", text: "インタビューを終了しました。" });
  }

  if (conversation.hasActiveSession(userId)) {
    return sendJson(res, 200, {
      response_type: "ephemeral",
      text: "既に進行中のインタビューがあります。DMで回答を続けるか、`/interview cancel` で終了してください。",
    });
  }

  // 先にSlackへ200を返しつつ、DMの送信は非同期で行う(スラッシュコマンドは3秒以内の応答が必要なため)
  sendJson(res, 200, {
    response_type: "ephemeral",
    text: "DMでインタビューを開始します。Botとのダイレクトメッセージを確認してください。",
  });

  try {
    const templateName = text || undefined;
    const displayName = await slack.getUserRealName(userId);
    const firstPrompt = conversation.startSession(userId, displayName, templateName);
    const dmChannel = await slack.openDirectMessage(userId);
    await slack.postMessage(dmChannel, `暗黙知インタビューを始めます。\n\n${firstPrompt}`);
  } catch (err) {
    console.error("スラッシュコマンド処理中にエラー:", err);
  }
}

async function handleEvents(req, res, rawBody) {
  const body = JSON.parse(rawBody);

  if (body.type === "url_verification") {
    return sendJson(res, 200, { challenge: body.challenge });
  }

  if (body.type !== "event_callback") {
    return sendJson(res, 200, {});
  }

  const event = body.event || {};

  // 即座に200を返す(Slackの再送を防ぐため)。実際の返信は非同期でpostMessageする。
  res.writeHead(200);
  res.end();

  const isUserDm = event.type === "message" && event.channel_type === "im" && !event.bot_id && !event.subtype;
  if (!isUserDm) return;

  try {
    const reply = await conversation.handleMessage(event.user, event.text);
    await slack.postMessage(event.channel, reply);
  } catch (err) {
    console.error("メッセージ処理中にエラー:", err);
    try {
      await slack.postMessage(event.channel, "処理中にエラーが発生しました。時間をおいて再度お試しください。");
    } catch (_) {
      // 通知自体に失敗した場合はログのみ
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const rawBody = await readRawBody(req);

    if (req.method === "POST" && req.url === "/slack/commands") {
      if (!slack.verifySignature(rawBody, req.headers)) {
        res.writeHead(401);
        return res.end("invalid signature");
      }
      return await handleSlashCommand(req, res, rawBody);
    }

    if (req.method === "POST" && req.url === "/slack/events") {
      if (!slack.verifySignature(rawBody, req.headers)) {
        res.writeHead(401);
        return res.end("invalid signature");
      }
      return await handleEvents(req, res, rawBody);
    }

    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end("internal error");
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Slack Botサーバーを起動しました: http://localhost:${PORT}`);
  });
}

module.exports = server;
