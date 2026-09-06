// lib/history.js
// 生成/使用したコメントの履歴を読み書きする共通処理。
// server.js(Webアプリ)とbot.js(GitHub Actions版)の両方から使う。

const fs = require("fs");
const path = require("path");

const HISTORY_PATH = path.join(__dirname, "..", "state", "history.json");
const MAX_HISTORY = 200;

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  const trimmed = history.slice(-MAX_HISTORY);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2), "utf-8");
}

module.exports = { loadHistory, saveHistory, HISTORY_PATH };
