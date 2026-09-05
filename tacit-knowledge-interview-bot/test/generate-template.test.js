const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { validateQuestions, slugForTemplateName } = require("../generate-template");

describe("validateQuestions", () => {
  test("accepts a well-formed question array", () => {
    const questions = [{ id: "a", category: "背景", question: "質問1" }];
    assert.deepEqual(validateQuestions(questions), questions);
  });

  test("rejects a non-array", () => {
    assert.throws(() => validateQuestions({}), /配列/);
  });

  test("rejects an empty array", () => {
    assert.throws(() => validateQuestions([]), /配列/);
  });

  test("rejects a question missing a required field", () => {
    assert.throws(() => validateQuestions([{ id: "a", category: "背景" }]), /不正/);
  });

  test("rejects duplicate ids", () => {
    const questions = [
      { id: "a", category: "背景", question: "質問1" },
      { id: "a", category: "別カテゴリ", question: "質問2" },
    ];
    assert.throws(() => validateQuestions(questions), /重複/);
  });
});

describe("slugForTemplateName", () => {
  test("lowercases and hyphenates a role description", () => {
    assert.equal(slugForTemplateName("Call Center Operator"), "call-center-operator");
  });

  test("falls back for a name with no usable characters", () => {
    assert.equal(slugForTemplateName("!!!"), "custom-template");
  });
});
