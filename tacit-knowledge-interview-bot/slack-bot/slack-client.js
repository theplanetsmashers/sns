// slack-bot/slack-client.js
// Slack Web APIの薄いラッパーとリクエスト署名検証。依存パッケージなし
// (Node標準の crypto と fetch のみ)で実装している。

const crypto = require("crypto");

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// https://api.slack.com/authentication/verifying-requests-from-slack
function verifySignature(rawBody, headers) {
  if (!SLACK_SIGNING_SECRET) {
    throw new Error("SLACK_SIGNING_SECRET が設定されていません。");
  }
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  const fiveMinutes = 60 * 5;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > fiveMinutes) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex")}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function callSlackApi(method, payload) {
  if (!SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN が設定されていません。");
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error (${method}): ${data.error}`);
  }
  return data;
}

async function openDirectMessage(userId) {
  const data = await callSlackApi("conversations.open", { users: userId });
  return data.channel.id;
}

async function postMessage(channel, text) {
  return callSlackApi("chat.postMessage", { channel, text });
}

async function getUserRealName(userId) {
  try {
    const data = await callSlackApi("users.info", { user: userId });
    return data.user.real_name || data.user.name || userId;
  } catch (e) {
    return userId;
  }
}

module.exports = {
  verifySignature,
  callSlackApi,
  openDirectMessage,
  postMessage,
  getUserRealName,
};
