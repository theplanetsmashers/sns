// lib/threadsApi.js
// Threads Graph API(公式)への薄いラッパー。
// 参照: https://developers.facebook.com/docs/threads
// - 自分の投稿一覧の取得
// - 投稿ごとのインサイト(閲覧数など)取得
// - 投稿へのコメント(リプライ)一覧取得
// - コメントへの返信の投稿(コンテナ作成 → publish の2段階)

const GRAPH_BASE = "https://graph.threads.net/v1.0";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphGet(pathname, params, accessToken) {
  const url = new URL(`${GRAPH_BASE}${pathname}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || JSON.stringify(body);
    throw new Error(`Threads API GET ${pathname} failed (${res.status}): ${msg}`);
  }
  return body;
}

async function graphPost(pathname, params, accessToken) {
  const url = new URL(`${GRAPH_BASE}${pathname}`);
  const form = new URLSearchParams({ ...params, access_token: accessToken });
  const res = await fetch(url, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || JSON.stringify(body);
    throw new Error(`Threads API POST ${pathname} failed (${res.status}): ${msg}`);
  }
  return body;
}

async function getMyProfile(accessToken) {
  return graphGet("/me", { fields: "id,username" }, accessToken);
}

async function listMyThreads(userId, accessToken, { limit = 25 } = {}) {
  const body = await graphGet(
    `/${userId}/threads`,
    { fields: "id,text,timestamp,permalink,media_type", limit },
    accessToken
  );
  return body.data || [];
}

// Threadsのメディアインサイトは投稿直後は取得できないことがあるため、
// 呼び出し側で失敗を許容してスキップできるようにエラーはそのまま投げる。
async function getInsights(mediaId, accessToken) {
  const body = await graphGet(
    `/${mediaId}/insights`,
    { metric: "views,likes,replies" },
    accessToken
  );
  const result = { views: 0, likes: 0, replies: 0 };
  for (const item of body.data || []) {
    const value = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
    if (item.name in result) result[item.name] = value;
  }
  return result;
}

async function listReplies(mediaId, accessToken) {
  const body = await graphGet(
    `/${mediaId}/replies`,
    { fields: "id,text,username,timestamp,hide_status" },
    accessToken
  );
  return body.data || [];
}

// コメントへの返信は「投稿コンテナ作成 → publish」の2段階。
// reply_to_id に相手のコメントIDを指定することで、そのコメントへの返信として投稿される。
async function createReply(userId, accessToken, { text, replyToId }) {
  const created = await graphPost(
    `/${userId}/threads`,
    { media_type: "TEXT", text, reply_to_id: replyToId },
    accessToken
  );
  if (!created.id) throw new Error("コンテナ作成のレスポンスにidがありません");

  // publish直後だと稀にコンテナがまだ処理中のことがあるため、公式ドキュメント推奨に沿って一呼吸置く
  await sleep(3000);

  const published = await graphPost(
    `/${userId}/threads_publish`,
    { creation_id: created.id },
    accessToken
  );
  return published;
}

module.exports = { getMyProfile, listMyThreads, getInsights, listReplies, createReply, sleep };
