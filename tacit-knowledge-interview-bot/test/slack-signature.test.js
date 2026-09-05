// slack-client.js reads SLACK_SIGNING_SECRET at module load time, so it must be
// set before the require() below.
process.env.SLACK_SIGNING_SECRET = "test-secret";
process.env.SLACK_BOT_TOKEN = "xoxb-test";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifySignature } = require("../slack-bot/slack-client");

function sign(body, timestamp, secret = "test-secret") {
  const base = `v0:${timestamp}:${body}`;
  return "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
}

describe("slack request signature verification", () => {
  test("accepts a correctly signed request", () => {
    const body = JSON.stringify({ hello: "world" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = { "x-slack-request-timestamp": timestamp, "x-slack-signature": sign(body, timestamp) };
    assert.equal(verifySignature(body, headers), true);
  });

  test("rejects a tampered body", () => {
    const body = JSON.stringify({ hello: "world" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signatureForDifferentBody = sign(JSON.stringify({ hello: "other" }), timestamp);
    const headers = { "x-slack-request-timestamp": timestamp, "x-slack-signature": signatureForDifferentBody };
    assert.equal(verifySignature(body, headers), false);
  });

  test("rejects a request signed with the wrong secret", () => {
    const body = "{}";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": sign(body, timestamp, "wrong-secret"),
    };
    assert.equal(verifySignature(body, headers), false);
  });

  test("rejects a stale timestamp (replay protection)", () => {
    const body = "{}";
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 60 * 10).toString(); // 10 minutes old
    const headers = { "x-slack-request-timestamp": oldTimestamp, "x-slack-signature": sign(body, oldTimestamp) };
    assert.equal(verifySignature(body, headers), false);
  });

  test("rejects a request missing signature headers", () => {
    assert.equal(verifySignature("{}", {}), false);
  });
});
