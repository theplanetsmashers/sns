// lib/state.js
// 「伸びている投稿」判定に使うインサイト履歴(snapshots.json)と、
// 返信済みコメントの記録(replied.json)の読み書き。

const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", "state");
const SNAPSHOTS_PATH = path.join(STATE_DIR, "snapshots.json");
const REPLIED_PATH = path.join(STATE_DIR, "replied.json");

const MAX_HISTORY_PER_POST = 30;
const MAX_REPLIED_RECORDS = 500;

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function loadSnapshots() {
  return loadJson(SNAPSHOTS_PATH, {});
}

function saveSnapshots(snapshots) {
  for (const entry of Object.values(snapshots)) {
    if (Array.isArray(entry.history) && entry.history.length > MAX_HISTORY_PER_POST) {
      entry.history = entry.history.slice(-MAX_HISTORY_PER_POST);
    }
  }
  saveJson(SNAPSHOTS_PATH, snapshots);
}

function loadReplied() {
  const records = loadJson(REPLIED_PATH, []);
  return { records, ids: new Set(records.map((r) => r.commentId)) };
}

function saveReplied(records) {
  const trimmed = records.slice(-MAX_REPLIED_RECORDS);
  saveJson(REPLIED_PATH, trimmed);
}

module.exports = { loadSnapshots, saveSnapshots, loadReplied, saveReplied, SNAPSHOTS_PATH, REPLIED_PATH };
