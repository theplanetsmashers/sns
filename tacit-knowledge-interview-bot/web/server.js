// web/server.js
// 暗黙知インタビューボットのWebアプリ版。CLI(interview.js)/Slack Bot(slack-bot/)と同じ
// lib/interview-engine.js を共有し、ブラウザからインタビュー実施→アウトプット生成→閲覧まで
// 一通り行える。依存パッケージなし(Node標準の http/crypto/fs のみ)。認証(登録・ログイン・
// Cookieセッション・CSRF)は web/lib/auth.js、Markdown表示は web/lib/render.js に切り出した。
//
// 使い方: npm run web  (デフォルト http://localhost:3002 、WEB_PORT で変更可)
//
// アカウントは自己登録制で、最初に登録したユーザーが管理者(admin)になる。管理者は
// 全ユーザーのインタビューと集計ダッシュボードを閲覧できる。一般ユーザーは自分が作成した
// インタビューのみ閲覧・操作できる。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const engine = require("../lib/interview-engine");
const { generateOutputsForSession } = require("../generate-outputs");
const dashboardLib = require("../generate-dashboard");
const auth = require("./lib/auth");
const { layout, mdToHtml, escapeHtml } = require("./lib/render");

const PORT = process.env.WEB_PORT || 3002;
const OUTPUTS_DIR = path.join(__dirname, "..", "outputs");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendHtml(res, status, html, extraHeaders = {}) {
  send(res, status, { "Content-Type": "text/html; charset=utf-8", ...extraHeaders }, html);
}

function redirect(res, location, extraHeaders = {}) {
  send(res, 303, { Location: location, ...extraHeaders }, "");
}

function page(res, status, { title, user, body, error }, extraHeaders = {}) {
  sendHtml(res, status, layout({ title, user, body, error }), extraHeaders);
}

// フォーム描画とCSRFトークンの発行をまとめて行う。フォームHTML中の {{csrf}} を
// 隠しinputに置き換え、対応するCookieをレスポンスヘッダーに積んで返す。
function withCsrf(req, formHtml) {
  const token = auth.ensureCsrfToken(req);
  const headers = { "Set-Cookie": auth.csrfCookie(req, token) };
  const html = formHtml.replace(
    "{{csrf}}",
    `<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`
  );
  return { html, headers };
}

// セッションJSONのファイル名(id)からパスを安全に解決する。呼び出し側は既にURLデコード
// 済みのプレーンな文字列を渡すこと。".."やパス区切りを含むidはパストラバーサルの
// 恐れがあるため拒否する。
function resolveSessionPath(id) {
  if (!id || /[\\/]/.test(id) || id.includes("..")) return null;
  const filePath = path.join(engine.SESSIONS_DIR, `${id}.json`);
  if (!filePath.startsWith(engine.SESSIONS_DIR + path.sep)) return null;
  return filePath;
}

function loadSessionById(id) {
  const filePath = resolveSessionPath(id);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { filePath, session: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
}

function canAccessSession(user, session) {
  return user.role === "admin" || session.owner === user.id;
}

function listMySessions(user) {
  if (!fs.existsSync(engine.SESSIONS_DIR)) return [];
  return fs
    .readdirSync(engine.SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      id: f.replace(/\.json$/, ""),
      session: JSON.parse(fs.readFileSync(path.join(engine.SESSIONS_DIR, f), "utf-8")),
    }))
    .filter(({ session }) => canAccessSession(user, session))
    .sort((a, b) => (a.session.created_at < b.session.created_at ? 1 : -1));
}

function requireAuth(req, res) {
  const user = auth.currentUser(req);
  if (!user) {
    redirect(res, "/login");
    return null;
  }
  return user;
}

function requireAdmin(req, res, user) {
  if (user.role !== "admin") {
    page(res, 403, { title: "権限がありません", user, body: "<p>この画面は管理者のみ閲覧できます。</p>" });
    return false;
  }
  return true;
}

// --- 認証まわり ---

function handleLoginPage(req, res, errorMsg) {
  const user = auth.currentUser(req);
  if (user) return redirect(res, "/");

  const form = `
    <div class="card" style="max-width:420px;margin:2rem auto">
      <h1>ログイン</h1>
      <form method="post" action="/login">
        {{csrf}}
        <label>メールアドレス</label>
        <input type="email" name="email" required autofocus>
        <label>パスワード</label>
        <input type="password" name="password" required>
        <button type="submit">ログイン</button>
      </form>
      <p style="margin-top:1rem;font-size:0.9rem">アカウントがない場合は <a href="/register">新規登録</a></p>
    </div>`;
  const { html, headers } = withCsrf(req, form);
  page(res, errorMsg ? 400 : 200, { title: "ログイン", user: null, body: html, error: errorMsg }, headers);
}

async function handleLogin(req, res, body) {
  if (!auth.verifyCsrf(req, body._csrf)) {
    return handleLoginPage(req, res, "セッションが無効です。もう一度お試しください。");
  }

  const email = String(body.email || "").trim().toLowerCase();
  const rateLimitKey = `login:${email}`;
  if (auth.isRateLimited(rateLimitKey)) {
    return handleLoginPage(req, res, "試行回数が多すぎます。しばらく待ってから再度お試しください。");
  }

  const foundUser = auth.findUserByEmail(email);
  const ok = foundUser && (await auth.verifyPassword(body.password || "", foundUser.passwordHash));
  if (!ok) {
    auth.recordLoginAttempt(rateLimitKey);
    return handleLoginPage(req, res, "メールアドレスまたはパスワードが正しくありません。");
  }

  const token = auth.createLoginSession(foundUser.id);
  redirect(res, "/", { "Set-Cookie": auth.sessionCookie(req, token) });
}

function handleRegisterPage(req, res, errorMsg) {
  const user = auth.currentUser(req);
  if (user) return redirect(res, "/");

  const form = `
    <div class="card" style="max-width:420px;margin:2rem auto">
      <h1>新規登録</h1>
      <form method="post" action="/register">
        {{csrf}}
        <label>メールアドレス</label>
        <input type="email" name="email" required autofocus>
        <label>パスワード(8文字以上)</label>
        <input type="password" name="password" required minlength="8">
        <button type="submit">登録する</button>
      </form>
      <p style="margin-top:1rem;font-size:0.9rem">最初に登録したアカウントが管理者になります。</p>
      <p style="font-size:0.9rem">アカウントをお持ちの場合は <a href="/login">ログイン</a></p>
    </div>`;
  const { html, headers } = withCsrf(req, form);
  page(res, errorMsg ? 400 : 200, { title: "新規登録", user: null, body: html, error: errorMsg }, headers);
}

async function handleRegister(req, res, body) {
  if (!auth.verifyCsrf(req, body._csrf)) {
    return handleRegisterPage(req, res, "セッションが無効です。もう一度お試しください。");
  }

  try {
    const user = await auth.createUser(body.email, body.password);
    const token = auth.createLoginSession(user.id);
    redirect(res, "/", { "Set-Cookie": auth.sessionCookie(req, token) });
  } catch (e) {
    if (e instanceof auth.ValidationError) return handleRegisterPage(req, res, e.message);
    throw e;
  }
}

function handleLogout(req, res) {
  const cookies = auth.parseCookies(req);
  auth.destroySession(cookies.sid);
  redirect(res, "/login", { "Set-Cookie": auth.clearSessionCookie(req) });
}

// --- ホーム / 新規インタビュー ---

function handleHome(req, res, user) {
  const rows = listMySessions(user);
  const items = rows.length
    ? rows
        .map(({ id, session }) => {
          let total = "?";
          try {
            total = engine.loadTemplate(session.template).length;
          } catch (e) {
            // テンプレートが削除されている等。件数は不明のまま表示する。
          }
          const answered = session.records.length;
          const done = total !== "?" && answered >= total;
          const ownerNote =
            user.role === "admin" && session.owner !== user.id ? ' <span class="badge">他ユーザー</span>' : "";
          return `<li><a href="/interview/${encodeURIComponent(id)}">${escapeHtml(session.topic)}</a>
            — ${escapeHtml(session.interviewee)} (${answered}/${total}問${done ? "・完了" : "・進行中"})${ownerNote}</li>`;
        })
        .join("\n")
    : "<li>まだインタビューがありません。</li>";

  const body = `
    <div class="card">
      <h1>マイインタビュー</h1>
      <ul class="session-list">${items}</ul>
      <a class="btn" href="/interview/new">+ 新しいインタビューを始める</a>
    </div>`;
  page(res, 200, { title: "ホーム", user, body });
}

function handleNewInterviewPage(req, res, user, errorMsg) {
  const templates = engine.listTemplateNames();
  const options = templates
    .map(
      (t) =>
        `<option value="${escapeHtml(t)}" ${t === engine.DEFAULT_TEMPLATE ? "selected" : ""}>${escapeHtml(t)}</option>`
    )
    .join("");
  const defaultDryRun = !process.env.ANTHROPIC_API_KEY;

  const form = `
    <div class="card">
      <h1>新しいインタビューを始める</h1>
      <form method="post" action="/interview/new">
        {{csrf}}
        <label>インタビュー対象者(名前・呼び名)</label>
        <input type="text" name="interviewee" required>
        <label>テーマ(担当していた工程・設備・役割など)</label>
        <input type="text" name="topic" required>
        <label>所属部署(任意)</label>
        <input type="text" name="department">
        <label>質問テンプレート</label>
        <select name="template">${options}</select>
        <label class="checkbox-row"><input type="checkbox" name="consent_internal" value="yes" checked> 社内マニュアル・研修資料の元データとして利用してよい</label>
        <label class="checkbox-row"><input type="checkbox" name="consent_public" value="yes"> note/ブログなど社外向け記事の元データとして利用してよい</label>
        <label class="checkbox-row"><input type="checkbox" name="dry_run" value="yes" ${defaultDryRun ? "checked" : ""}> ドライランで実行する(Claude APIを呼ばず無料で試す)</label>
        <button type="submit">開始する</button>
      </form>
    </div>`;
  const { html, headers } = withCsrf(req, form);
  page(res, errorMsg ? 400 : 200, { title: "新しいインタビュー", user, body: html, error: errorMsg }, headers);
}

function handleNewInterview(req, res, user, body) {
  if (!auth.verifyCsrf(req, body._csrf)) {
    return handleNewInterviewPage(req, res, user, "セッションが無効です。もう一度お試しください。");
  }

  const interviewee = String(body.interviewee || "").trim();
  const topic = String(body.topic || "").trim();
  if (!interviewee || !topic) return handleNewInterviewPage(req, res, user, "対象者とテーマは必須です。");

  const templateName = body.template || engine.DEFAULT_TEMPLATE;
  try {
    engine.loadTemplate(templateName);
  } catch (e) {
    return handleNewInterviewPage(req, res, user, e.message);
  }

  if (body.consent_internal !== "yes") {
    return handleNewInterviewPage(req, res, user, "社内利用への同意がない場合は記録を開始できません。");
  }

  const session = {
    interviewee,
    topic,
    department: String(body.department || "").trim() || "未設定",
    template: templateName,
    owner: user.id,
    created_at: new Date().toISOString(),
    consent: { internal: true, public: body.consent_public === "yes" },
    dry_run: body.dry_run === "yes",
    records: [],
  };

  const sessionPath = engine.newSessionPath(topic);
  engine.saveSession(sessionPath, session);
  redirect(res, `/interview/${encodeURIComponent(path.basename(sessionPath, ".json"))}`);
}

// --- インタビュー実施 ---

function renderProgress(session, template) {
  const answered = session.records.length;
  const pct = Math.round((answered / template.length) * 100);
  return `<div class="card">
    <strong>${escapeHtml(session.topic)}</strong> — ${escapeHtml(session.interviewee)}
    <div style="margin-top:0.5rem;background:rgba(127,127,127,0.15);border-radius:5px;overflow:hidden;height:8px">
      <div style="width:${pct}%;background:#2a5db0;height:100%"></div>
    </div>
    <p style="font-size:0.85rem;color:#888;margin-bottom:0">${answered}/${template.length}問 回答済み</p>
  </div>`;
}

function handleInterviewPage(req, res, user, id, errorMsg) {
  const found = loadSessionById(id);
  if (!found || !canAccessSession(user, found.session)) {
    return page(res, 404, { title: "見つかりません", user, body: "<p>インタビューが見つかりません。</p>" });
  }
  const { session } = found;
  const template = engine.loadTemplate(session.template);

  if (session.pending) {
    const form = `
      <div class="card">
        <h2>[${escapeHtml(session.pending.category)}] 深掘り質問</h2>
        <p>${escapeHtml(session.pending.followupQuestion)}</p>
        <form method="post" action="/interview/${encodeURIComponent(id)}/answer">
          {{csrf}}
          <textarea name="answer" placeholder="回答を入力してください(空欄のまま送信すると、この深掘りをスキップします)"></textarea>
          <button type="submit">送信する</button>
        </form>
      </div>`;
    const { html, headers } = withCsrf(req, form);
    const body = renderProgress(session, template) + html;
    return page(res, errorMsg ? 400 : 200, { title: session.topic, user, body, error: errorMsg }, headers);
  }

  if (session.records.length < template.length) {
    const q = template[session.records.length];
    const form = `
      <div class="card">
        <h2>[${escapeHtml(q.category)}]</h2>
        <p>${escapeHtml(q.question)}</p>
        <form method="post" action="/interview/${encodeURIComponent(id)}/answer">
          {{csrf}}
          <textarea name="answer" required></textarea>
          <button type="submit">回答する</button>
        </form>
      </div>`;
    const { html, headers } = withCsrf(req, form);
    const body = renderProgress(session, template) + html;
    return page(res, errorMsg ? 400 : 200, { title: session.topic, user, body, error: errorMsg }, headers);
  }

  // 全問完了
  const outDir = path.join(OUTPUTS_DIR, path.basename(found.filePath, ".json"));
  const hasOutputs = fs.existsSync(outDir);
  const thin = session.records.filter((r) => r.richness_score <= 2);
  const thinHtml = thin.length
    ? `<p>以下のカテゴリは内容が抽象的なままでした。別セッションで深掘りをおすすめします:</p>
       <ul>${thin.map((r) => `<li>[${escapeHtml(r.category)}] 濃さ${r.richness_score}/5</li>`).join("")}</ul>`
    : "<p>すべての項目で十分な濃さの回答が得られました。</p>";

  const actionHtml = hasOutputs
    ? `<a class="btn" href="/interview/${encodeURIComponent(id)}/outputs">生成済みの出力を見る</a>`
    : `<form method="post" action="/interview/${encodeURIComponent(id)}/outputs">
         {{csrf}}
         <button type="submit">マニュアル・ケーススタディ・記事を生成する</button>
       </form>`;

  const raw = `
    <div class="card">
      <h1>${escapeHtml(session.topic)}</h1>
      <p>対象者: ${escapeHtml(session.interviewee)} / 部署: ${escapeHtml(session.department)}</p>
      <p>インタビューは完了しています(${session.records.length}/${template.length}問)。</p>
      ${thinHtml}
      ${actionHtml}
    </div>`;
  const { html, headers } = withCsrf(req, raw);
  page(res, 200, { title: session.topic, user, body: html }, headers);
}

async function handleAnswer(req, res, user, id, body) {
  const found = loadSessionById(id);
  if (!found || !canAccessSession(user, found.session)) {
    return page(res, 404, { title: "見つかりません", user, body: "<p>インタビューが見つかりません。</p>" });
  }
  if (!auth.verifyCsrf(req, body._csrf)) {
    return handleInterviewPage(req, res, user, id, "セッションが無効です。もう一度お試しください。");
  }

  const { session, filePath } = found;
  const template = engine.loadTemplate(session.template);
  const analyze = session.dry_run ? engine.analyzeAnswerOffline : engine.analyzeAnswer;
  const answer = String(body.answer || "").trim();

  if (session.pending) {
    const { qId, category, question, answer: firstAnswer, followupQuestion } = session.pending;
    let summary, richnessScore, followupAnswer;
    if (answer) {
      const combined = await analyze(
        category,
        `${question}\n(深掘り) ${followupQuestion}`,
        `${firstAnswer}\n(深掘り回答) ${answer}`
      );
      summary = combined.summary;
      richnessScore = combined.richness_score;
      followupAnswer = answer;
    } else {
      const original = await analyze(category, question, firstAnswer);
      summary = original.summary;
      richnessScore = original.richness_score;
      followupAnswer = "";
    }
    session.records.push({
      id: qId,
      category,
      question,
      answer: firstAnswer,
      followup_question: followupQuestion,
      followup_answer: followupAnswer,
      summary,
      richness_score: richnessScore,
    });
    delete session.pending;
    engine.saveSession(filePath, session);
    return redirect(res, `/interview/${encodeURIComponent(id)}`);
  }

  if (session.records.length >= template.length) {
    return redirect(res, `/interview/${encodeURIComponent(id)}`);
  }

  const q = template[session.records.length];
  if (!answer) {
    return handleInterviewPage(req, res, user, id, "回答を入力してください。");
  }

  const analysis = await analyze(q.category, q.question, answer);
  if (analysis.needs_followup && analysis.followup_question) {
    session.pending = {
      qId: q.id,
      category: q.category,
      question: q.question,
      answer,
      followupQuestion: analysis.followup_question,
    };
  } else {
    session.records.push({
      id: q.id,
      category: q.category,
      question: q.question,
      answer,
      followup_question: "",
      followup_answer: "",
      summary: analysis.summary,
      richness_score: analysis.richness_score,
    });
  }
  engine.saveSession(filePath, session);
  redirect(res, `/interview/${encodeURIComponent(id)}`);
}

async function handleGenerateOutputs(req, res, user, id, body) {
  const found = loadSessionById(id);
  if (!found || !canAccessSession(user, found.session)) {
    return page(res, 404, { title: "見つかりません", user, body: "<p>インタビューが見つかりません。</p>" });
  }
  if (!auth.verifyCsrf(req, body._csrf)) {
    return handleInterviewPage(req, res, user, id, "セッションが無効です。もう一度お試しください。");
  }

  try {
    await generateOutputsForSession(found.filePath, {});
  } catch (e) {
    return page(res, 500, {
      title: "生成エラー",
      user,
      body: `<div class="card"><p>アウトプット生成中にエラーが発生しました。</p><pre>${escapeHtml(e.message)}</pre>
        <a href="/interview/${encodeURIComponent(id)}">戻る</a></div>`,
    });
  }
  redirect(res, `/interview/${encodeURIComponent(id)}/outputs`);
}

function handleOutputsPage(req, res, user, id) {
  const found = loadSessionById(id);
  if (!found || !canAccessSession(user, found.session)) {
    return page(res, 404, { title: "見つかりません", user, body: "<p>インタビューが見つかりません。</p>" });
  }
  const baseName = path.basename(found.filePath, ".json");
  const outDir = path.join(OUTPUTS_DIR, baseName);
  if (!fs.existsSync(outDir)) {
    return page(res, 404, {
      title: "未生成",
      user,
      body: `<p>まだ出力が生成されていません。<a href="/interview/${encodeURIComponent(id)}">戻る</a></p>`,
    });
  }

  const candidates = [
    { key: "manual", file: "manual.md", label: "マニュアル" },
    { key: "case-study", file: "case-study.md", label: "研修ケース" },
    { key: "article", file: "article.md", label: "記事" },
  ];
  const files = candidates.filter((f) => fs.existsSync(path.join(outDir, f.file)));

  const tabs = files.map((f) => `<a href="#${f.key}">${escapeHtml(f.label)}</a>`).join("");
  const sections = files
    .map((f) => {
      const md = fs.readFileSync(path.join(outDir, f.file), "utf-8");
      return `<section id="${f.key}" class="card"><h2>${escapeHtml(f.label)}</h2>${mdToHtml(md)}</section>`;
    })
    .join("\n");

  const body = `
    <p><a href="/interview/${encodeURIComponent(id)}">← インタビューに戻る</a></p>
    <nav class="tabs">${tabs}</nav>
    ${sections}`;
  page(res, 200, { title: `${found.session.topic} の出力`, user, body });
}

function handleDashboard(req, res) {
  const sessions = dashboardLib.loadSessions();
  const agg = dashboardLib.aggregate(sessions);
  const html = dashboardLib
    .renderHtml(sessions, agg)
    .replace("</body>", '<p style="padding:0 2rem 2rem"><a href="/">← ホームに戻る</a></p></body>');
  sendHtml(res, 200, html);
}

// --- ルーティング ---

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const method = req.method;

    if (method === "GET" && segments.length === 0) {
      const user = auth.currentUser(req);
      if (!user) return redirect(res, "/login");
      return handleHome(req, res, user);
    }

    if (method === "GET" && segments[0] === "login") return handleLoginPage(req, res);
    if (method === "POST" && segments[0] === "login") {
      return await handleLogin(req, res, parseForm(await readBody(req)));
    }
    if (method === "GET" && segments[0] === "register") return handleRegisterPage(req, res);
    if (method === "POST" && segments[0] === "register") {
      return await handleRegister(req, res, parseForm(await readBody(req)));
    }
    if (method === "POST" && segments[0] === "logout") return handleLogout(req, res);

    if (segments[0] === "interview") {
      const user = requireAuth(req, res);
      if (!user) return;

      if (method === "GET" && segments[1] === "new") return handleNewInterviewPage(req, res, user);
      if (method === "POST" && segments[1] === "new") {
        return handleNewInterview(req, res, user, parseForm(await readBody(req)));
      }

      // URLセグメントはブラウザ側でパーセントエンコードされて届く。ここで一度だけ
      // デコードし、以降はプレーンな文字列として扱う(ハンドラ内でURLを組み立てる際は
      // encodeURIComponentを1回だけ呼ぶ。多重エンコード/デコードによる不一致を防ぐため)。
      const id = segments[1] ? decodeURIComponent(segments[1]) : null;

      if (id && segments[2] === "answer" && method === "POST") {
        return await handleAnswer(req, res, user, id, parseForm(await readBody(req)));
      }
      if (id && segments[2] === "outputs" && method === "POST") {
        return await handleGenerateOutputs(req, res, user, id, parseForm(await readBody(req)));
      }
      if (id && segments[2] === "outputs" && method === "GET") {
        return handleOutputsPage(req, res, user, id);
      }
      if (id && method === "GET") {
        return handleInterviewPage(req, res, user, id);
      }
    }

    if (method === "GET" && segments[0] === "dashboard") {
      const user = requireAuth(req, res);
      if (!user) return;
      if (!requireAdmin(req, res, user)) return;
      return handleDashboard(req, res);
    }

    send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "404 Not Found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Internal Server Error");
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Webアプリを起動しました: http://localhost:${PORT}`);
  });
}

module.exports = server;
