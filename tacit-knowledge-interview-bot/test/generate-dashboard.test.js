const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { aggregate } = require("../generate-dashboard");

function record(category, richness_score) {
  return { category, richness_score, question: "q", answer: "a", summary: "s" };
}

describe("generate-dashboard aggregate()", () => {
  test("groups sessions by department and averages richness per department", () => {
    const sessions = [
      { file: "a.json", interviewee: "山田", department: "製造1課", records: [record("背景", 4), record("失敗", 2)] },
      { file: "b.json", interviewee: "佐藤", department: "製造1課", records: [record("背景", 2)] },
      { file: "c.json", interviewee: "鈴木", department: "製造2課", records: [record("背景", 5)] },
    ];

    const { departmentRows } = aggregate(sessions);
    const dept1 = departmentRows.find((d) => d.department === "製造1課");
    const dept2 = departmentRows.find((d) => d.department === "製造2課");

    assert.equal(dept1.sessions, 2);
    assert.equal(dept1.avgScore, "2.67"); // (4+2+2)/3
    assert.equal(dept2.sessions, 1);
    assert.equal(dept2.avgScore, "5.00");
  });

  test("defaults missing department to 未設定", () => {
    const sessions = [{ file: "a.json", interviewee: "山田", records: [record("背景", 3)] }];
    const { departmentRows } = aggregate(sessions);
    assert.equal(departmentRows[0].department, "未設定");
  });

  test("sorts category rows by ascending average score (weakest first)", () => {
    const sessions = [
      {
        file: "a.json",
        interviewee: "山田",
        department: "d",
        records: [record("強いカテゴリ", 5), record("弱いカテゴリ", 1)],
      },
    ];
    const { categoryRows } = aggregate(sessions);
    assert.equal(categoryRows[0].category, "弱いカテゴリ");
    assert.equal(categoryRows[categoryRows.length - 1].category, "強いカテゴリ");
  });

  test("flags records at or below the follow-up threshold (2)", () => {
    const sessions = [
      {
        file: "a.json",
        interviewee: "山田",
        department: "d",
        topic: "テーマ",
        records: [record("要フォロー", 2), record("OK", 3)],
      },
    ];
    const { followUps } = aggregate(sessions);
    assert.equal(followUps.length, 1);
    assert.equal(followUps[0].category, "要フォロー");
  });

  test("handles an empty session list without throwing", () => {
    const { departmentRows, categoryRows, followUps } = aggregate([]);
    assert.deepEqual(departmentRows, []);
    assert.deepEqual(categoryRows, []);
    assert.deepEqual(followUps, []);
  });
});
