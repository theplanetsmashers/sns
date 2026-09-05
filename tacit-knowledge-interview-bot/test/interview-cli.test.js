const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../interview");

describe("interview.js parseArgs", () => {
  test("parses --key=value pairs", () => {
    const args = parseArgs(["--interviewee=山田さん", "--topic=金型交換"]);
    assert.equal(args.interviewee, "山田さん");
    assert.equal(args.topic, "金型交換");
  });

  test("treats a bare --flag as boolean true", () => {
    const args = parseArgs(["--dry-run", "--list-templates"]);
    assert.equal(args["dry-run"], true);
    assert.equal(args["list-templates"], true);
  });

  test("ignores positional (non --flag) arguments", () => {
    const args = parseArgs(["sessions/foo.json", "--resume=sessions/foo.json"]);
    assert.equal(args.resume, "sessions/foo.json");
    assert.equal(Object.keys(args).length, 1);
  });

  test("returns an empty object for no arguments", () => {
    assert.deepEqual(parseArgs([]), {});
  });
});
