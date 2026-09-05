const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// auth.js はモジュール読み込み時にデータディレクトリを決定するため、実データ
// (web/data/)を汚さないよう、requireする前にWEB_DATA_DIRで一時ディレクトリへ差し替える。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "interview-bot-auth-test-"));
process.env.WEB_DATA_DIR = tmpDir;
const auth = require("../../web/lib/auth");

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("password hashing", () => {
  test("verifyPassword accepts the correct password and rejects a wrong one", async () => {
    const hash = await auth.hashPassword("correct-horse");
    assert.equal(await auth.verifyPassword("correct-horse", hash), true);
    assert.equal(await auth.verifyPassword("wrong-password", hash), false);
  });

  test("verifyPassword rejects malformed stored hashes instead of throwing", async () => {
    assert.equal(await auth.verifyPassword("anything", "not-a-hash"), false);
    assert.equal(await auth.verifyPassword("anything", ""), false);
  });
});

describe("createUser", () => {
  test("the first user created becomes admin, subsequent users become plain users", async () => {
    const first = await auth.createUser("first@example.com", "password123");
    const second = await auth.createUser("second@example.com", "password123");
    assert.equal(first.role, "admin");
    assert.equal(second.role, "user");
  });

  test("rejects a duplicate email", async () => {
    await assert.rejects(() => auth.createUser("first@example.com", "password123"), auth.ValidationError);
  });

  test("rejects a short password", async () => {
    await assert.rejects(() => auth.createUser("short@example.com", "abc"), auth.ValidationError);
  });

  test("rejects an invalid email", async () => {
    await assert.rejects(() => auth.createUser("not-an-email", "password123"), auth.ValidationError);
  });

  test("findUserByEmail is case-insensitive", () => {
    const found = auth.findUserByEmail("FIRST@EXAMPLE.COM");
    assert.ok(found);
    assert.equal(found.email, "first@example.com");
  });
});

describe("login sessions", () => {
  test("createLoginSession round-trips through getSession", async () => {
    const user = await auth.createUser("session-user@example.com", "password123");
    const token = auth.createLoginSession(user.id);
    const session = auth.getSession(token);
    assert.ok(session);
    assert.equal(session.userId, user.id);
  });

  test("destroySession invalidates the token", async () => {
    const user = await auth.createUser("session-user-2@example.com", "password123");
    const token = auth.createLoginSession(user.id);
    auth.destroySession(token);
    assert.equal(auth.getSession(token), null);
  });

  test("getSession returns null for an unknown token", () => {
    assert.equal(auth.getSession("does-not-exist"), null);
  });
});

describe("CSRF double-submit token", () => {
  test("verifyCsrf accepts a matching cookie/body pair and rejects a mismatch", () => {
    const req = { headers: { cookie: "csrf=abc123" }, socket: {} };
    assert.equal(auth.verifyCsrf(req, "abc123"), true);
    assert.equal(auth.verifyCsrf(req, "wrong"), false);
    assert.equal(auth.verifyCsrf({ headers: {}, socket: {} }, "abc123"), false);
  });
});

describe("rate limiting", () => {
  test("isRateLimited trips after repeated attempts for the same key", () => {
    const key = "rate-limit-test-key";
    assert.equal(auth.isRateLimited(key), false);
    for (let i = 0; i < 8; i++) auth.recordLoginAttempt(key);
    assert.equal(auth.isRateLimited(key), true);
  });
});
