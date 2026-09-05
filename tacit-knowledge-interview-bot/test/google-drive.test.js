const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { installMockFetch } = require("./helpers/mock-fetch");
const drive = require("../lib/google-drive");

let testPrivateKey;
before(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  testPrivateKey = privateKey;
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: testPrivateKey,
  });
});

describe("lib/google-drive", () => {
  test("getAccessToken signs a JWT and returns the mocked access token", async () => {
    const restore = installMockFetch();
    try {
      const token = await drive.getAccessToken();
      assert.equal(token, "mock-access-token");
    } finally {
      restore();
    }
  });

  test("findOrCreateFolder creates a folder when none matches, and returns its id", async () => {
    const restore = installMockFetch();
    try {
      const token = await drive.getAccessToken();
      const folderId = await drive.findOrCreateFolder("山田さん", "root-folder-id", token);
      assert.ok(folderId.startsWith("mock-id-"));
    } finally {
      restore();
    }
  });

  test("uploadFile issues a multipart POST for a new file", async () => {
    let capturedRequest = null;
    const restore = installMockFetch();
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (String(url).includes("upload/drive/v3/files")) capturedRequest = { url: String(url), opts };
      return originalFetch(url, opts);
    };
    try {
      const token = await drive.getAccessToken();
      await drive.uploadFile("manual.md", "# hello", "text/markdown", "session-folder-id", token);
      assert.ok(capturedRequest, "expected an upload request to be made");
      assert.equal(capturedRequest.opts.method, "POST");
      assert.match(capturedRequest.opts.headers["Content-Type"], /multipart\/related/);
      assert.match(capturedRequest.opts.body, /manual\.md/);
      assert.match(capturedRequest.opts.body, /# hello/);
    } finally {
      restore();
    }
  });
});
