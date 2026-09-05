// web/lib/render.js
// Markdownの簡易HTML変換とページレイアウトの共通化。外部パッケージを使わない方針のため、
// generate-outputs.js が書き出すMarkdown(見出し・表・引用・箇条書き・強調・コードフェンス)
// に絞った最小限のパーサーになっている(汎用Markdown処理系ではない)。

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

function renderTable(tableLines) {
  const rows = tableLines.map((l) =>
    l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
  );
  const isSeparator = (row) => row.every((c) => /^:?-+:?$/.test(c));
  const header = rows[0];
  const bodyRows = rows[1] && isSeparator(rows[1]) ? rows.slice(2) : rows.slice(1);

  const headHtml = `<tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>`;
  const bodyHtml = bodyRows
    .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n${headHtml}\n${bodyHtml}\n</table>`;
}

function mdToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let listOpen = false;
  let quoteBuffer = null;

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  function flushQuote() {
    if (quoteBuffer !== null) {
      html.push(`<blockquote>${quoteBuffer}</blockquote>`);
      quoteBuffer = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      closeList();
      flushQuote();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      i++;
      continue;
    }

    if (/^\|.*\|\s*$/.test(line)) {
      closeList();
      flushQuote();
      const tableLines = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      const content = line.replace(/^>\s?/, "");
      quoteBuffer = quoteBuffer === null ? inline(content) : `${quoteBuffer}<br>${inline(content)}`;
      i++;
      continue;
    }
    flushQuote();

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      closeList();
      html.push("<hr>");
      i++;
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (listItem) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inline(listItem[1])}</li>`);
      i++;
      continue;
    }
    closeList();

    if (line.trim() === "") {
      i++;
      continue;
    }

    html.push(`<p>${inline(line)}</p>`);
    i++;
  }

  closeList();
  flushQuote();
  return html.join("\n");
}

const BASE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; margin: 0; background: #f7f7f5; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #eee; }
    .card, table, pre { background: #262626 !important; }
    input, select, textarea { background:#1a1a1a; color:#eee; border-color:#444 !important; }
    th { background:#333 !important; }
    td, th { border-color:#444 !important; }
    a { color:#8ab4ff; }
    header { background: rgba(255,255,255,0.05) !important; }
  }
  a { color: #2a5db0; }
  header { display:flex; align-items:center; justify-content:space-between; padding: 0.8rem 1.5rem; background: rgba(127,127,127,0.08); border-bottom: 1px solid rgba(127,127,127,0.2); flex-wrap: wrap; gap: 0.5rem; }
  header nav a { margin-left: 1rem; }
  main { max-width: 900px; margin: 0 auto; padding: 1.5rem; }
  .card { background:#fff; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  label { display:block; margin: 0.75rem 0 0.25rem; font-weight: 600; font-size: 0.9rem; }
  input[type=text], input[type=email], input[type=password], select, textarea {
    width:100%; padding:0.5rem 0.6rem; border-radius:6px; border:1px solid #ccc; font-size:0.95rem;
  }
  textarea { min-height: 8rem; font-family: inherit; }
  button, .btn { display:inline-block; margin-top:1rem; padding:0.55rem 1.2rem; border:none; border-radius:6px; background:#2a5db0; color:#fff; font-size:0.95rem; cursor:pointer; text-decoration:none; }
  button.secondary, .btn.secondary { background:#888; }
  .error { color:#c0392b; background:rgba(192,57,43,0.1); padding:0.6rem 0.9rem; border-radius:6px; margin-bottom:1rem; }
  .badge { display:inline-block; padding:0.1rem 0.5rem; border-radius:999px; font-size:0.75rem; background:rgba(127,127,127,0.15); margin-left:0.4rem; }
  table { border-collapse: collapse; width:100%; margin: 1rem 0; display:block; overflow-x:auto; }
  th, td { border:1px solid #ddd; padding:0.45rem 0.65rem; text-align:left; font-size:0.9rem; }
  pre { overflow-x:auto; background:#f0f0f0; padding:0.75rem; border-radius:6px; }
  blockquote { border-left: 3px solid #2a5db0; margin: 0.75rem 0; padding: 0.4rem 0.9rem; background: rgba(42,93,176,0.06); }
  .session-list { list-style:none; padding:0; }
  .session-list li { margin-bottom: 0.5rem; }
  nav.tabs { display:flex; gap:0.5rem; margin-bottom:1rem; flex-wrap:wrap; }
  nav.tabs a { padding:0.4rem 0.9rem; border-radius:6px; background:rgba(127,127,127,0.12); text-decoration:none; color:inherit; }
  .checkbox-row { display:flex; align-items:center; gap:0.5rem; font-weight:normal; }
  .checkbox-row input { width:auto; }
`;

function layout({ title, user, body, error }) {
  const nav = user
    ? `<span>${escapeHtml(user.email)}<span class="badge">${escapeHtml(user.role)}</span></span>
       <nav>
         <a href="/">ホーム</a>
         ${user.role === "admin" ? '<a href="/dashboard">ダッシュボード</a>' : ""}
         <form method="post" action="/logout" style="display:inline">
           <button type="submit" class="secondary" style="margin:0;padding:0.3rem 0.8rem;font-size:0.85rem">ログアウト</button>
         </form>
       </nav>`
    : `<nav><a href="/login">ログイン</a><a href="/register">新規登録</a></nav>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - 暗黙知インタビューボット</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<header>
  <strong><a href="/" style="text-decoration:none;color:inherit">🗣️ 暗黙知インタビューボット</a></strong>
  ${nav}
</header>
<main>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
  ${body}
</main>
</body>
</html>`;
}

module.exports = { escapeHtml, inline, mdToHtml, layout };
