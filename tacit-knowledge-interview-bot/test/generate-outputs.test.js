const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { buildTranscript, buildOfflinePreview } = require("../generate-outputs");

function session(records) {
  return { interviewee: "山田さん", topic: "金型交換", department: "製造1課", records };
}

describe("buildTranscript", () => {
  test("formats each record with category/question/answer/summary", () => {
    const transcript = buildTranscript(
      session([{ category: "背景・役割", question: "Q1", answer: "A1", summary: "S1" }])
    );
    assert.match(transcript, /【背景・役割】/);
    assert.match(transcript, /Q: Q1/);
    assert.match(transcript, /A: A1/);
    assert.match(transcript, /要約: S1/);
  });

  test("includes the follow-up Q&A only when present", () => {
    const withFollowup = buildTranscript(
      session([
        {
          category: "c",
          question: "Q1",
          answer: "A1",
          followup_question: "FQ",
          followup_answer: "FA",
          summary: "S1",
        },
      ])
    );
    assert.match(withFollowup, /深掘りQ: FQ/);
    assert.match(withFollowup, /深掘りA: FA/);

    const withoutFollowup = buildTranscript(session([{ category: "c", question: "Q1", answer: "A1", summary: "S1" }]));
    assert.doesNotMatch(withoutFollowup, /深掘り/);
  });
});

describe("buildOfflinePreview (dry-run placeholder)", () => {
  test("clearly labels itself as a dry-run placeholder", () => {
    const preview = buildOfflinePreview(session([]), "社内向け技術継承マニュアル");
    assert.match(preview, /ドライランモードのプレースホルダー/);
    assert.match(preview, /社内向け技術継承マニュアル/);
  });

  test("includes every record's question, answer, summary, and richness score", () => {
    const preview = buildOfflinePreview(
      session([{ category: "背景・役割", question: "Q1", answer: "A1", summary: "S1", richness_score: 4 }]),
      "研修用ケーススタディ"
    );
    assert.match(preview, /背景・役割/);
    assert.match(preview, /濃さ 4\/5/);
    assert.match(preview, /Q1/);
    assert.match(preview, /A1/);
    assert.match(preview, /S1/);
  });
});
