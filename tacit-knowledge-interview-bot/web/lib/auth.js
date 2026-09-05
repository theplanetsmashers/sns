// web/lib/auth.js
// Webアプリのユーザー認証(登録・ログイン・セッションCookie・CSRF)をまとめたモジュール。
// 依存パッケージなしの方針を踏襲し、パスワードハッシュはNode標準のcrypto.scryptを使う。
// ユーザー/ログインセッションは web/data/*.json にJSONで永続化する(再起動でも消えない)。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

// テスト等でデータの保存先を切り替えられるよう環境変数での上書きを許可する
// (本番では常にデフォルトの web/data を使う)。
const DATA_DIR = process.env.WEB_DATA_DIR || path.join(__dirname, "..", "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const SESSIONS_PATH = path.join(DATA_DIR, "login-sessions.json");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    return fallback;
  }
}

function saveJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

let users = loadJson(USERS_PATH, []);
let loginSessions = loadJson(SESSIONS_PATH, {});

function persistUsers() {
  saveJson(USERS_PATH, users);
}

function persistSessions() {
  saveJson(SESSIONS_PATH, loginSessions);
}

function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return users.find((u) => u.email === normalized) || null;
}

function findUserById(id) {
  return users.find((u) => u.id === id) || null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

class ValidationError extends Error {}

async function createUser(email, password) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ValidationError("メールアドレスの形式が正しくありません。");
  }
  if (String(password || "").length < 8) {
    throw new ValidationError("パスワードは8文字以上にしてください。");
  }
  if (findUserByEmail(normalized)) {
    throw new ValidationError("このメールアドレスは既に登録されています。");
  }

  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash: await hashPassword(password),
    role: users.length === 0 ? "admin" : "user", // 最初の登録者を管理者にする
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  persistUsers();
  return user;
}

function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [token, s] of Object.entries(loginSessions)) {
    if (s.expiresAt < now) {
      delete loginSessions[token];
      changed = true;
    }
  }
  if (changed) persistSessions();
}

function createLoginSession(userId) {
  pruneExpiredSessions();
  const token = crypto.randomBytes(32).toString("hex");
  loginSessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS };
  persistSessions();
  return token;
}

function getSession(token) {
  if (!token) return null;
  const s = loginSessions[token];
  if (!s || s.expiresAt < Date.now()) return null;
  return s;
}

function destroySession(token) {
  if (token && loginSessions[token]) {
    delete loginSessions[token];
    persistSessions();
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const session = getSession(cookies.sid);
  if (!session) return null;
  return findUserById(session.userId);
}

function isHttpsRequest(req) {
  return req.socket.encrypted === true || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(req, token) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

function clearSessionCookie(req) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

// CSRF対策: フォーム描画時にCookieへ乱数トークンを積み、送信時にフォーム内の隠しフィールドと
// 突き合わせる(double-submit cookie方式)。ログイン前のフォーム(ログイン/登録)も保護対象に
// したいため、ログイン済みセッションに紐付けずCookie単体で完結させている。
function ensureCsrfToken(req) {
  const cookies = parseCookies(req);
  return cookies.csrf || crypto.randomBytes(24).toString("hex");
}

function csrfCookie(req, token) {
  const secure = isHttpsRequest(req) ? "; Secure" : "";
  return `csrf=${token}; Path=/; SameSite=Lax${secure}`;
}

function verifyCsrf(req, bodyToken) {
  const cookies = parseCookies(req);
  return !!cookies.csrf && !!bodyToken && cookies.csrf === bodyToken;
}

const loginAttempts = new Map(); // key -> timestamps[]

function isRateLimited(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((t) => now - t < LOGIN_ATTEMPT_WINDOW_MS);
  loginAttempts.set(key, attempts);
  return attempts.length >= LOGIN_ATTEMPT_LIMIT;
}

function recordLoginAttempt(key) {
  const attempts = loginAttempts.get(key) || [];
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

module.exports = {
  ValidationError,
  findUserByEmail,
  findUserById,
  createUser,
  hashPassword,
  verifyPassword,
  createLoginSession,
  getSession,
  destroySession,
  currentUser,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  ensureCsrfToken,
  csrfCookie,
  verifyCsrf,
  isRateLimited,
  recordLoginAttempt,
};
