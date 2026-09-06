// lib/store.js
// 部下プロフィールと1on1ログの読み書き共通処理。

const fs = require("fs");
const path = require("path");

const STATE_DIR = path.join(__dirname, "..", "state");
const SUBORDINATES_PATH = path.join(STATE_DIR, "subordinates.json");
const LOGS_PATH = path.join(STATE_DIR, "logs.json");
const MAX_LOGS = 1000;

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function loadSubordinates() {
  return loadJson(SUBORDINATES_PATH);
}

function saveSubordinates(subordinates) {
  saveJson(SUBORDINATES_PATH, subordinates);
}

function loadLogs() {
  return loadJson(LOGS_PATH);
}

function saveLogs(logs) {
  saveJson(LOGS_PATH, logs.slice(-MAX_LOGS));
}

function logsForSubordinate(logs, subordinateId) {
  return logs.filter((l) => l.subordinateId === subordinateId);
}

module.exports = {
  loadSubordinates,
  saveSubordinates,
  loadLogs,
  saveLogs,
  logsForSubordinate,
  SUBORDINATES_PATH,
  LOGS_PATH,
};
