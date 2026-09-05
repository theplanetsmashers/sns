// lib/google-drive.js
// generate-outputs.js から呼ばれる、Google Drive(サービスアカウント)へのアップロード処理。
// 「ペルソナ・体験」フォルダ構造(ルートフォルダ > 対象者名 > セッション)を自動作成し、
// インタビュー記録とマニュアル/研修ケース/記事をアップロードする。
//
// 必要な環境変数:
//   GOOGLE_SERVICE_ACCOUNT_KEY   サービスアカウントのJSONキーを1行の文字列にしたもの
//   GOOGLE_DRIVE_ROOT_FOLDER_ID  アップロード先のルートフォルダID(サービスアカウントと共有済みのもの)
//
// 依存パッケージなし(Node.js標準の crypto と fetch のみ)で実装しているのは、
// このリポジトリの他のスクリプト(threads-post-generator, interview.js)と
// 同じ「npm installなしで動く」方針に合わせるため。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const engine = require("./interview-engine");

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getServiceAccountKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が設定されていません。");
  }
  return JSON.parse(raw);
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const key = getServiceAccountKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key);
  const jwt = `${unsigned}.${signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google OAuth error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function escapeForQuery(name) {
  return name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findEntry(name, parentId, token, extraQuery = "") {
  const q = `name='${escapeForQuery(name)}' and '${parentId}' in parents and trashed=false${extraQuery}`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Drive API error (list): ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : null;
}

async function createFolder(name, parentId, token) {
  const res = await fetch(DRIVE_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!res.ok) {
    throw new Error(`Drive API error (create folder): ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.id;
}

async function findOrCreateFolder(name, parentId, token) {
  const existing = await findEntry(
    name,
    parentId,
    token,
    " and mimeType='application/vnd.google-apps.folder'"
  );
  if (existing) return existing;
  return createFolder(name, parentId, token);
}

async function uploadFile(name, content, mimeType, parentId, token) {
  const existingId = await findEntry(name, parentId, token, " and mimeType!='application/vnd.google-apps.folder'");
  const metadata = existingId ? { name } : { name, parents: [parentId] };
  const boundary = `drive-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `${DRIVE_UPLOAD_URL}/${existingId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart`;
  const method = existingId ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive API error (upload ${name}): ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// セッションのインタビュー記録と生成物一式を、対象者名>セッション名のフォルダ構造でアップロードする
async function uploadSessionOutputs(sessionPath, session, outDir) {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID が設定されていません。");
  }

  const token = await getAccessToken();
  const personaFolderId = await findOrCreateFolder(session.interviewee, rootFolderId, token);
  const sessionFolderName = `${(session.created_at || "").slice(0, 10)}_${engine.slugify(session.topic)}`;
  const sessionFolderId = await findOrCreateFolder(sessionFolderName, personaFolderId, token);

  await uploadFile(
    "interview_record.json",
    JSON.stringify(session, null, 2),
    "application/json",
    sessionFolderId,
    token
  );

  const mdFiles = fs.readdirSync(outDir).filter((f) => f.endsWith(".md"));
  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(outDir, file), "utf-8");
    await uploadFile(file, content, "text/markdown", sessionFolderId, token);
  }

  return { personaFolderId, sessionFolderId, uploaded: ["interview_record.json", ...mdFiles] };
}

module.exports = {
  getAccessToken,
  findOrCreateFolder,
  uploadFile,
  uploadSessionOutputs,
};
