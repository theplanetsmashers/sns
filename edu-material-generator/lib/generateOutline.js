// lib/generateOutline.js
// Claude APIを使って、テーマ名から講義の構成(スライド内容+ナレーション原稿)を丸ごと生成する。

async function generateOutline({ topic, level, slideCount, language, note }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const n = Number(slideCount) > 0 ? Math.min(Number(slideCount), 20) : 8;
  const lang = language || "日本語";
  const lvl = level || "初心者";

  const prompt = `あなたはオンライン講座の教材制作を専門とするインストラクショナルデザイナーです。
以下のテーマについて、動画講義用のスライド教材一式を作成してください。

【テーマ】${topic}
【想定受講者レベル】${lvl}
【出力言語】${lang}
【スライド枚数】本編 ${n} 枚(タイトルスライドとまとめスライドは別途自動で付くので、本編の内容だけを${n}枚分作ること)
${note ? `【追加の指示】${note}\n` : ""}
【教材の条件】
- 受講者がこの講義を見るだけで実際に学べる、体系立った構成にすること(いきなり詳細に入らず、導入→本論→まとめの流れ)
- 各スライドは「そのスライドだけで1つの論点が完結する」ように設計する
- bullets(画面に表示する箇条書き)は短く簡潔に(各項目20〜40文字程度)、1スライド3〜5項目
- narration(講師が話すナレーション原稿)は、bulletsをそのまま読み上げるのではなく、口語で自然に説明を補う形にする。1スライドあたり150〜300文字程度、聞いて理解できる話し言葉にする
- 専門用語は${lvl}にもわかるように噛み砕く

出力は次のJSON形式のみ。前置き・説明・コードブロック(\`\`\`)は一切つけないこと。

{
  "title": "講義全体のタイトル",
  "objectives": ["この講義で学べること1", "学べること2", "学べること3"],
  "slides": [
    { "title": "スライドタイトル", "bullets": ["項目1", "項目2", "項目3"], "narration": "ナレーション原稿" }
  ],
  "summary": {
    "title": "まとめスライドのタイトル(例: まとめ)",
    "bullets": ["要点1", "要点2", "要点3"],
    "narration": "まとめのナレーション原稿"
  }
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c) => c.type === "text");
  const raw = textBlock ? textBlock.text.trim() : "";

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Claude の応答からJSONを抽出できませんでした。");
  }

  let outline;
  try {
    outline = JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`Claude の応答のJSON解析に失敗しました: ${err.message}`);
  }

  if (!outline.title || !Array.isArray(outline.slides) || outline.slides.length === 0) {
    throw new Error("生成された講義構成が不完全です(title/slidesが不足)。");
  }

  outline.slides = outline.slides.map((s) => ({
    title: String(s.title || "").trim(),
    bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).trim()).filter(Boolean) : [],
    narration: String(s.narration || "").trim(),
  }));

  if (!outline.summary) {
    outline.summary = { title: "まとめ", bullets: [], narration: "" };
  }

  return outline;
}

module.exports = { generateOutline };
