const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { installMockFetch } = require("./helpers/mock-fetch");
const conversation = require("../slack-bot/conversation");

// このモジュールは実際に sessions/ 配下へファイルを書き込むので、作ったセッションは
// 各テストの最後に必ず削除してテスト実行環境を汚さないようにする。
const createdSessionPaths = [];
after(() => {
  for (const p of createdSessionPaths) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

function trackAndCleanup(userId) {
  const state = conversation.userStates.get(userId);
  if (state && state.sessionPath) createdSessionPaths.push(state.sessionPath);
  conversation.cancelSession(userId);
}

describe("slack-bot conversation state machine", () => {
  test("runs consent + all questions through to completion", async () => {
    const restore = installMockFetch();
    const userId = "U-full-flow";
    try {
      const firstPrompt = conversation.startSession(userId, "テスト太郎", "manufacturing-supervisor");
      assert.match(firstPrompt, /テーマ/);

      await conversation.handleMessage(userId, "プレス加工の金型交換");
      await conversation.handleMessage(userId, "yes"); // consent internal
      const afterConsentPublic = await conversation.handleMessage(userId, "yes"); // consent public
      assert.match(afterConsentPublic, /インタビューを始めます/);

      const template = require("../lib/interview-engine").loadTemplate("manufacturing-supervisor");
      let lastReply;
      for (let i = 0; i < template.length; i++) {
        lastReply = await conversation.handleMessage(userId, `回答その${i + 1}`);
      }

      assert.match(lastReply, /インタビューが完了しました/);

      const state = conversation.userStates.get(userId);
      assert.equal(state.phase, "done");
      assert.equal(state.session.records.length, template.length);
      assert.equal(state.session.consent.internal, true);
      assert.equal(state.session.consent.public, true);
      assert.ok(fs.existsSync(state.sessionPath));
    } finally {
      trackAndCleanup(userId);
      restore();
    }
  });

  test("declining internal consent cancels without saving a session", async () => {
    const restore = installMockFetch();
    const userId = "U-decline";
    try {
      conversation.startSession(userId, "テスト花子", "manufacturing-supervisor");
      await conversation.handleMessage(userId, "何かのテーマ");
      const reply = await conversation.handleMessage(userId, "no");
      assert.match(reply, /中止/);
      assert.equal(conversation.hasActiveSession(userId), false);
    } finally {
      restore();
    }
  });

  test("asks exactly one follow-up when the model requests it, then continues", async () => {
    let callCount = 0;
    const restore = installMockFetch([
      {
        match: (p) => p.includes('"needs_followup"'),
        reply: () => {
          callCount++;
          if (callCount === 1) {
            return JSON.stringify({
              needs_followup: true,
              followup_question: "もっと具体的な数値はありますか?",
              summary: "",
              richness_score: 2,
            });
          }
          return JSON.stringify({
            needs_followup: false,
            followup_question: "",
            summary: "深掘り後の要約",
            richness_score: 4,
          });
        },
      },
    ]);
    const userId = "U-followup";
    try {
      conversation.startSession(userId, "テスト次郎", "manufacturing-supervisor");
      await conversation.handleMessage(userId, "テーマ");
      await conversation.handleMessage(userId, "yes");
      await conversation.handleMessage(userId, "no");

      const followupPrompt = await conversation.handleMessage(userId, "最初の回答");
      assert.match(followupPrompt, /深掘り質問/);
      assert.match(followupPrompt, /もっと具体的な数値はありますか/);

      const afterFollowup = await conversation.handleMessage(userId, "深掘りへの回答");
      assert.match(afterFollowup, /深掘り後の要約/);
      assert.match(afterFollowup, /濃さ: 4\/5/);

      const state = conversation.userStates.get(userId);
      assert.equal(state.session.records[0].followup_question, "もっと具体的な数値はありますか?");
      assert.equal(state.session.records[0].followup_answer, "深掘りへの回答");
    } finally {
      trackAndCleanup(userId);
      restore();
    }
  });

  test("handleMessage without an active session prompts to start one", async () => {
    const reply = await conversation.handleMessage("U-no-session", "何か発言");
    assert.match(reply, /\/interview/);
  });
});
