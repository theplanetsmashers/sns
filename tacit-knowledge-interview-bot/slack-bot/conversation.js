// slack-bot/conversation.js
// Slack上でインタビューを進行させるための状態機械。Slack APIやHTTPのことは一切知らず、
// 「ユーザーID + 受信テキスト」を受け取って「返信テキスト」を返すだけの純粋なロジック。
// 同じ lib/interview-engine.js を使っているため、CLI(interview.js)と質問内容・
// 深掘り判定・要約ロジックは完全に共通。
//
// テストは、Claude API呼び出しをモックした状態でこのモジュールだけを require して行える
// (HTTPサーバーやSlackの認証を一切経由しない)。

const engine = require("../lib/interview-engine");

// userId -> 進行中の会話状態。プロセス再起動で消えても、途中まで進んだセッションJSON自体は
// sessions/ に残っているため、最悪ユーザーは /interview resume 相当をやり直すだけで済む。
const userStates = new Map();

function currentQuestion(state) {
  return state.template[state.session.records.length];
}

function questionPrompt(q) {
  return `--- [${q.category}] ---\n${q.question}`;
}

function pushRecord(state, q, answer, followupQuestion, followupAnswer, summary, richnessScore) {
  state.session.records.push({
    id: q.id,
    category: q.category,
    question: q.question,
    answer,
    followup_question: followupQuestion,
    followup_answer: followupAnswer,
    summary,
    richness_score: richnessScore,
  });
  engine.saveSession(state.sessionPath, state.session);
}

function finishSummary(state) {
  const thin = state.session.records.filter((r) => r.richness_score <= 2);
  const lines = [
    `インタビューが完了しました。記録を保存しました: ${state.sessionPath}`,
  ];
  if (thin.length > 0) {
    lines.push("");
    lines.push("以下のカテゴリは内容が抽象的なままでした。別セッションで深掘りをおすすめします:");
    for (const r of thin) lines.push(`  - [${r.category}] 濃さ${r.richness_score}/5`);
  }
  lines.push("");
  lines.push(
    `マニュアル・研修ケース・note記事を生成するには、サーバー側で以下を実行してください:`
  );
  lines.push(`  npm run outputs -- ${state.sessionPath}`);
  return lines.join("\n");
}

function moveToNextOrFinish(state, prevSummary, prevScore) {
  if (state.session.records.length >= state.template.length) {
    state.phase = "done";
    return `要約: ${prevSummary} (濃さ: ${prevScore}/5)\n\n${finishSummary(state)}`;
  }
  const nextQ = currentQuestion(state);
  return `要約: ${prevSummary} (濃さ: ${prevScore}/5)\n\n${questionPrompt(nextQ)}`;
}

// 新しいインタビューを開始する。呼び出し側(Slackのスラッシュコマンドハンドラ)から呼ぶ。
function startSession(userId, interviewee, templateName) {
  let name = templateName;
  let template;
  try {
    template = engine.loadTemplate(name || engine.DEFAULT_TEMPLATE);
    name = name || engine.DEFAULT_TEMPLATE;
  } catch (e) {
    name = engine.DEFAULT_TEMPLATE;
    template = engine.loadTemplate(name);
  }

  userStates.set(userId, {
    phase: "awaiting_topic",
    interviewee,
    templateName: name,
    template,
    session: null,
    sessionPath: null,
    pendingFollowup: null,
  });

  return "今回のインタビューのテーマ(担当していた工程・役割など)を一言で教えてください。";
}

function hasActiveSession(userId) {
  return userStates.has(userId);
}

function cancelSession(userId) {
  userStates.delete(userId);
}

// Slackから届いたメッセージ本文を、進行中の会話状態に応じて処理し、返信テキストを返す
async function handleMessage(userId, text) {
  const state = userStates.get(userId);
  if (!state) {
    return "先に `/interview` コマンドでインタビューを開始してください。";
  }

  const trimmed = (text || "").trim();

  switch (state.phase) {
    case "awaiting_topic": {
      if (!trimmed) return "テーマを入力してください。";
      state.topic = trimmed;
      state.phase = "awaiting_consent_internal";
      return "この記録を社内マニュアル・研修資料の元データとして利用してよいですか?(yes/no)";
    }

    case "awaiting_consent_internal": {
      const yes = /^y(es)?$/i.test(trimmed);
      if (!yes) {
        cancelSession(userId);
        return "社内利用への同意がないため、インタビューを中止しました。記録は保存されません。";
      }
      state.phase = "awaiting_consent_public";
      return "この記録をnote/ブログなど社外向け記事の元データとして利用してよいですか?(yes/no)";
    }

    case "awaiting_consent_public": {
      const consentPublic = /^y(es)?$/i.test(trimmed);
      state.session = {
        interviewee: state.interviewee,
        topic: state.topic,
        department: "未設定",
        template: state.templateName,
        created_at: new Date().toISOString(),
        consent: { internal: true, public: consentPublic },
        records: [],
      };
      state.sessionPath = engine.newSessionPath(state.topic);
      engine.saveSession(state.sessionPath, state.session);
      state.phase = "awaiting_answer";
      return `ありがとうございます。それではインタビューを始めます。\n\n${questionPrompt(currentQuestion(state))}`;
    }

    case "awaiting_answer": {
      if (!trimmed) {
        return `回答が空でした。もう一度お願いします。\n${currentQuestion(state).question}`;
      }
      const q = currentQuestion(state);
      const analysis = await engine.analyzeAnswer(q.category, q.question, trimmed);

      if (analysis.needs_followup && analysis.followup_question) {
        state.pendingFollowup = { q, answer: trimmed, followupQuestion: analysis.followup_question };
        state.phase = "awaiting_followup";
        return `(深掘り質問) ${analysis.followup_question}`;
      }

      pushRecord(state, q, trimmed, "", "", analysis.summary, analysis.richness_score);
      return moveToNextOrFinish(state, analysis.summary, analysis.richness_score);
    }

    case "awaiting_followup": {
      const { q, answer, followupQuestion } = state.pendingFollowup;
      if (!trimmed) {
        return `深掘り回答が空でした。もう一度お願いします。\n${followupQuestion}`;
      }
      const combined = await engine.analyzeAnswer(
        q.category,
        `${q.question}\n(深掘り) ${followupQuestion}`,
        `${answer}\n(深掘り回答) ${trimmed}`
      );
      pushRecord(state, q, answer, followupQuestion, trimmed, combined.summary, combined.richness_score);
      state.pendingFollowup = null;
      state.phase = "awaiting_answer";
      return moveToNextOrFinish(state, combined.summary, combined.richness_score);
    }

    case "done":
      return "このインタビューは既に完了しています。新しく始めるには `/interview` コマンドを使ってください。";

    default:
      return "予期しない状態です。`/interview` コマンドで最初からやり直してください。";
  }
}

module.exports = {
  userStates,
  startSession,
  handleMessage,
  hasActiveSession,
  cancelSession,
};
