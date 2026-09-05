const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { installMockFetch } = require("./helpers/mock-fetch");
const engine = require("../lib/interview-engine");

describe("slugify", () => {
  test("keeps Japanese and alphanumeric characters, replaces the rest", () => {
    assert.equal(engine.slugify("プレス加工 の 金型交換!!"), "プレス加工_の_金型交換_");
  });

  test("falls back to 'session' for an empty/whitespace-only string", () => {
    assert.equal(engine.slugify("   "), "session");
  });

  test("truncates to 30 characters", () => {
    const long = "あ".repeat(50);
    assert.equal(engine.slugify(long).length, 30);
  });
});

describe("templates", () => {
  test("listTemplateNames includes the two shipped templates", () => {
    const names = engine.listTemplateNames();
    assert.ok(names.includes("manufacturing-supervisor"));
    assert.ok(names.includes("general-tacit-knowledge"));
  });

  test("loadTemplate returns an array of {id, category, question}", () => {
    const template = engine.loadTemplate("manufacturing-supervisor");
    assert.ok(Array.isArray(template));
    assert.ok(template.length > 0);
    for (const q of template) {
      assert.equal(typeof q.id, "string");
      assert.equal(typeof q.category, "string");
      assert.equal(typeof q.question, "string");
    }
  });

  test("loadTemplate throws a helpful error for an unknown template", () => {
    assert.throws(() => engine.loadTemplate("does-not-exist"), /見つかりません/);
  });
});

describe("analyzeAnswerOffline (dry-run, no network)", () => {
  test("scores richness by answer length only", () => {
    assert.equal(engine.analyzeAnswerOffline("c", "q", "短い").richness_score, 1);
    assert.equal(engine.analyzeAnswerOffline("c", "q", "あ".repeat(30)).richness_score, 2);
    assert.equal(engine.analyzeAnswerOffline("c", "q", "あ".repeat(60)).richness_score, 3);
    assert.equal(engine.analyzeAnswerOffline("c", "q", "あ".repeat(150)).richness_score, 4);
    assert.equal(engine.analyzeAnswerOffline("c", "q", "あ".repeat(250)).richness_score, 5);
  });

  test("never asks for a follow-up (no LLM available to design one)", () => {
    const result = engine.analyzeAnswerOffline("category", "question", "何らかの回答");
    assert.equal(result.needs_followup, false);
    assert.equal(result.followup_question, "");
  });
});

describe("analyzeAnswer (mocked Claude API)", () => {
  test("parses the JSON the model returns", async () => {
    const restore = installMockFetch([
      {
        match: (p) => p.includes('"needs_followup"'),
        reply: () =>
          JSON.stringify({
            needs_followup: true,
            followup_question: "もう少し具体的に教えてください",
            summary: "テスト要約",
            richness_score: 2,
          }),
      },
    ]);
    try {
      const result = await engine.analyzeAnswer("背景・役割", "質問文", "回答文");
      assert.equal(result.needs_followup, true);
      assert.equal(result.followup_question, "もう少し具体的に教えてください");
      assert.equal(result.summary, "テスト要約");
      assert.equal(result.richness_score, 2);
    } finally {
      restore();
    }
  });

  test("falls back gracefully when the model reply isn't valid JSON", async () => {
    const restore = installMockFetch([
      { match: (p) => p.includes('"needs_followup"'), reply: () => "not json at all" },
    ]);
    try {
      const result = await engine.analyzeAnswer("cat", "q", "生の回答");
      assert.equal(result.needs_followup, false);
      assert.equal(result.summary, "生の回答");
      assert.equal(result.richness_score, 3);
    } finally {
      restore();
    }
  });
});

describe("newSessionPath / saveSession", () => {
  test("newSessionPath embeds a slugified topic under SESSIONS_DIR", () => {
    const p = engine.newSessionPath("テストのトピック");
    assert.ok(p.startsWith(engine.SESSIONS_DIR));
    assert.ok(p.includes("テストのトピック"));
    assert.ok(p.endsWith(".json"));
  });
});
