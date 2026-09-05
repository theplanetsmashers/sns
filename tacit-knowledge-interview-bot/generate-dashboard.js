// generate-dashboard.js
// sessions/ 配下の全インタビュー記録を横断集計し、部門別・カテゴリ別の暗黙知の
// 「濃さ(richness_score)」を可視化する静的HTMLダッシュボードを生成する。
// 法人向け(人事・技能伝承部門)に、どの部門・どのテーマの継承が手薄かを
// 一覧で見せるための機能。
//
// 使い方: node generate-dashboard.js [出力先パス(省略時 outputs/dashboard.html)]

const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(__dirname, "sessions");
const OUTPUTS_DIR = path.join(__dirname, "outputs");
const FOLLOW_UP_THRESHOLD = 2;

function loadSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8")) }));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function aggregate(sessions) {
  const byDepartment = new Map();
  const byCategory = new Map();
  const followUps = [];

  for (const session of sessions) {
    const dept = session.department || "未設定";
    if (!byDepartment.has(dept)) byDepartment.set(dept, { sessions: 0, scoreSum: 0, scoreCount: 0 });
    const deptStats = byDepartment.get(dept);
    deptStats.sessions += 1;

    for (const r of session.records || []) {
      if (typeof r.richness_score !== "number") continue;

      deptStats.scoreSum += r.richness_score;
      deptStats.scoreCount += 1;

      if (!byCategory.has(r.category)) byCategory.set(r.category, { sum: 0, count: 0 });
      const catStats = byCategory.get(r.category);
      catStats.sum += r.richness_score;
      catStats.count += 1;

      if (r.richness_score <= FOLLOW_UP_THRESHOLD) {
        followUps.push({
          interviewee: session.interviewee,
          department: dept,
          topic: session.topic,
          category: r.category,
          score: r.richness_score,
          file: session.file,
        });
      }
    }
  }

  const departmentRows = [...byDepartment.entries()].map(([dept, s]) => ({
    department: dept,
    sessions: s.sessions,
    avgScore: s.scoreCount ? (s.scoreSum / s.scoreCount).toFixed(2) : "-",
  }));

  const categoryRows = [...byCategory.entries()]
    .map(([category, s]) => ({ category, avgScore: s.sum / s.count, count: s.count }))
    .sort((a, b) => a.avgScore - b.avgScore);

  followUps.sort((a, b) => a.score - b.score);

  return { departmentRows, categoryRows, followUps };
}

function renderBar(avgScore) {
  const pct = Math.max(0, Math.min(100, (avgScore / 5) * 100));
  const color = avgScore <= 2 ? "#d64545" : avgScore <= 3.5 ? "#d6a545" : "#3f9f5f";
  return `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

function renderHtml(sessions, agg) {
  const totalInterviewees = new Set(sessions.map((s) => s.interviewee)).size;

  const departmentRowsHtml = agg.departmentRows
    .map(
      (d) =>
        `<tr><td>${escapeHtml(d.department)}</td><td>${d.sessions}</td><td>${d.avgScore}</td></tr>`
    )
    .join("\n");

  const categoryRowsHtml = agg.categoryRows
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.category)}</td><td>${renderBar(c.avgScore)}</td><td>${c.avgScore.toFixed(
          2
        )} (n=${c.count})</td></tr>`
    )
    .join("\n");

  const followUpsHtml = agg.followUps.length
    ? agg.followUps
        .map(
          (f) =>
            `<tr><td>${escapeHtml(f.interviewee)}</td><td>${escapeHtml(f.department)}</td><td>${escapeHtml(
              f.topic
            )}</td><td>${escapeHtml(f.category)}</td><td>${f.score}/5</td><td><code>${escapeHtml(
              f.file
            )}</code></td></tr>`
        )
        .join("\n")
    : `<tr><td colspan="6">現在フォローアップが必要な項目はありません。</td></tr>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>暗黙知マップ ダッシュボード</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; margin: 0; padding: 2rem; background: #f7f7f5; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #1a1a1a; color: #eee; } table { background: #262626; } th { background: #333; } td, th { border-color: #444 !important; } .bar-track { background: #333 !important; } }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; }
  .summary { display: flex; gap: 1.5rem; margin: 1rem 0 2rem; flex-wrap: wrap; }
  .stat { background: rgba(127,127,127,0.1); border-radius: 8px; padding: 0.75rem 1.25rem; }
  .stat .num { font-size: 1.6rem; font-weight: 700; display: block; }
  table { border-collapse: collapse; width: 100%; max-width: 100%; overflow-x: auto; display: block; background: #fff; border-radius: 6px; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.9rem; white-space: nowrap; }
  .bar-track { width: 160px; height: 10px; background: #eee; border-radius: 5px; overflow: hidden; display: inline-block; }
  .bar-fill { height: 100%; }
  .generated-at { color: #888; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>暗黙知マップ ダッシュボード</h1>
<p class="generated-at">生成日時: ${new Date().toISOString()}</p>

<div class="summary">
  <div class="stat"><span class="num">${sessions.length}</span>インタビュー件数</div>
  <div class="stat"><span class="num">${totalInterviewees}</span>対象者数</div>
  <div class="stat"><span class="num">${agg.followUps.length}</span>要フォローアップ項目</div>
</div>

<h2>部門別サマリー</h2>
<table>
  <tr><th>部門</th><th>インタビュー件数</th><th>平均の濃さ(1〜5)</th></tr>
  ${departmentRowsHtml || "<tr><td colspan=3>データがありません</td></tr>"}
</table>

<h2>カテゴリ別 暗黙知の濃さ(全部門横断・低い順)</h2>
<table>
  <tr><th>カテゴリ</th><th></th><th>平均スコア</th></tr>
  ${categoryRowsHtml || "<tr><td colspan=3>データがありません</td></tr>"}
</table>

<h2>要フォローアップ一覧(濃さ${FOLLOW_UP_THRESHOLD}以下)</h2>
<table>
  <tr><th>対象者</th><th>部門</th><th>テーマ</th><th>カテゴリ</th><th>濃さ</th><th>セッションファイル</th></tr>
  ${followUpsHtml}
</table>

</body>
</html>
`;
}

function main() {
  const sessions = loadSessions();
  const agg = aggregate(sessions);
  const html = renderHtml(sessions, agg);

  const outPath = path.resolve(process.argv[2] || path.join(OUTPUTS_DIR, "dashboard.html"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");

  console.log(`ダッシュボードを生成しました: ${outPath}`);
  console.log(`セッション数: ${sessions.length} / 要フォローアップ項目: ${agg.followUps.length}`);
}

if (require.main === module) {
  main();
}

module.exports = { aggregate, loadSessions, renderHtml };
