// lib/generate.js
// Claude APIを使って、1on1の準備・振り返り・傾向分析の文章を生成する共通処理。

async function callClaude(prompt, maxTokens = 1000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  return textBlock ? textBlock.text.trim() : "";
}

function parseJsonLoose(raw, fallbackShape) {
  try {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return JSON.parse(match ? match[0] : raw);
  } catch {
    return fallbackShape;
  }
}

function recentLogsSummary(logs, limit = 5) {
  const recent = logs.slice(-limit);
  if (recent.length === 0) return "(まだ過去の1on1記録はありません。今回が初回です)";
  return recent
    .map((l) => {
      const points = (l.summary?.keyPoints || []).map((p) => `  - ${p}`).join("\n");
      const follow = (l.summary?.followUps || []).map((p) => `  - ${p}`).join("\n");
      return `【${l.date}】\n要点:\n${points || "  (なし)"}\n次回フォロー:\n${follow || "  (なし)"}`;
    })
    .join("\n\n");
}

// 1on1前: アジェンダ案を生成する。直属部下と委任先チームリーダーで観点を変える。
async function generateAgenda({ subordinate, recentStatus, logs }) {
  const history = recentLogsSummary(logs);
  const isDelegate = subordinate.type === "delegate";

  const roleGuidance = isDelegate
    ? `相手は業務を委任しているチームリーダーです。個人の成長支援よりも、以下の観点を優先してください。
- 委任した範囲の進捗と、判断に迷っている論点
- チーム内で本人が下した判断とその根拠(原理原則に基づいているか、場当たり的になっていないか)
- エスカレーションすべきか本人判断で進めてよいかの境界線の確認
- チームメンバーの状況で共有しておくべきこと`
    : `相手は直属の部下です。以下の観点を優先してください。
- 業務の進捗・障害だけでなく、本人の意思決定の拠り所(何を基準に判断したか)
- 成長・キャリアに関わる話題
- モチベーションや負荷の状態`;

  const prompt = `あなたは新任管理職の1on1準備を手伝うアシスタントです。
以下の情報をもとに、今回の1on1で話すべきアジェンダ案を作成してください。

【相手のプロフィール】
名前: ${subordinate.name}
役割: ${subordinate.role || "(未記入)"}
経験年数: ${subordinate.experienceYears || "(未記入)"}
関係: ${isDelegate ? "委任先チームリーダー" : "直属部下"}

【今回のアジェンダで重視すべき観点】
${roleGuidance}

【直近の業務状況(本人からの申告・管理職の観察メモ)】
${recentStatus || "(特になし)"}

【過去の1on1記録(直近分)】
${history}

【出力条件】
- アジェンダ項目を3〜5個、優先度順に並べる
- 各項目には「何を確認・議論すべきか」に加えて「なぜ今回それを扱うべきか(前回からの継続か、新しい兆候か)」を短く添える
- 感想ベースではなく、判断や事実に基づいた具体的な問いかけにする
- 出力は次のJSON形式のみ。前置き・説明・コードブロックは一切つけないこと。

{"agenda": [{"topic": "項目名", "reason": "なぜ今回扱うべきか", "question": "具体的な問いかけ例"}]}`;

  const raw = await callClaude(prompt, 1200);
  const parsed = parseJsonLoose(raw, { agenda: [] });
  return Array.isArray(parsed.agenda) ? parsed.agenda : [];
}

// 1on1後: 生メモから要点・判断基準・次回フォローを抽出する。
async function summarizeLog({ subordinate, memo, logs }) {
  const history = recentLogsSummary(logs);
  const isDelegate = subordinate.type === "delegate";

  const prompt = `あなたは新任管理職の1on1振り返りを手伝うアシスタントです。
以下の1on1メモから、後で見返して使える形に要点を抽出してください。

【相手のプロフィール】
名前: ${subordinate.name}
役割: ${subordinate.role || "(未記入)"}
関係: ${isDelegate ? "委任先チームリーダー" : "直属部下"}

【過去の1on1記録(直近分、傾向把握の参考に)】
${history}

【今回の1on1メモ(生データ)】
${memo}

【抽出方針(重要)】
- 「良い感じだった」のような感想ではなく、何が起きて・何を根拠にどう判断したかを言語化する
- judgmentCriteria(判断基準)には、本人またはあなたが今回下した判断の「拠り所にした原理原則・基準」を書く。感想や状況説明はここに含めない
- followUps(次回フォロー)には、次回の1on1で必ず確認すべき具体的な項目を書く
- 出力は次のJSON形式のみ。前置き・説明・コードブロックは一切つけないこと。

{
  "keyPoints": ["今回の1on1で起きた事実・話した内容の要点"],
  "judgmentCriteria": ["今回の判断や助言の拠り所にした基準・原則"],
  "followUps": ["次回確認すべき具体的な項目"]
}`;

  const raw = await callClaude(prompt, 1200);
  const parsed = parseJsonLoose(raw, { keyPoints: [], judgmentCriteria: [], followUps: [] });
  return {
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    judgmentCriteria: Array.isArray(parsed.judgmentCriteria) ? parsed.judgmentCriteria : [],
    followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
  };
}

// 複数回のログから、部下ごとの変化・傾向をサマリー化する。
async function generateTrend({ subordinate, logs }) {
  if (logs.length === 0) {
    return { summary: "まだ1on1記録がありません。記録が増えると傾向を分析できます。", signals: [] };
  }

  const full = logs
    .map((l) => {
      const points = (l.summary?.keyPoints || []).join(" / ");
      const criteria = (l.summary?.judgmentCriteria || []).join(" / ");
      const follow = (l.summary?.followUps || []).join(" / ");
      return `【${l.date}】\n要点: ${points || "(なし)"}\n判断基準: ${criteria || "(なし)"}\n次回フォロー: ${follow || "(なし)"}`;
    })
    .join("\n\n");

  const prompt = `あなたは新任管理職の評価面談・異動判断の材料づくりを手伝うアシスタントです。
以下は同じ部下との複数回の1on1記録です。時系列の変化・傾向を分析してください。

【相手のプロフィール】
名前: ${subordinate.name}
役割: ${subordinate.role || "(未記入)"}
経験年数: ${subordinate.experienceYears || "(未記入)"}

【1on1記録(時系列順)】
${full}

【分析条件】
- 印象論ではなく、記録に残っている事実・判断基準の変化から傾向を読み取る
- summaryには、評価面談や異動判断の材料になる形で全体傾向を3〜5文程度でまとめる
- signalsには、特に注目すべき変化の兆候を箇条書きで挙げる(良い兆候・懸念の兆候どちらも)
- 出力は次のJSON形式のみ。前置き・説明・コードブロックは一切つけないこと。

{"summary": "全体傾向のまとめ", "signals": ["注目すべき変化の兆候"]}`;

  const raw = await callClaude(prompt, 1200);
  const parsed = parseJsonLoose(raw, { summary: "", signals: [] });
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
  };
}

module.exports = { generateAgenda, summarizeLog, generateTrend };
