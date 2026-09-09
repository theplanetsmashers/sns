// lib/generateScript.js
// Claude APIを使って、note記事の本文から「約30秒のYouTube紹介動画」の台本を生成する。
// output_config.format(構造化出力)でJSON Schemaを指定し、応答が必ずスキーマに一致することを
// API側で保証させている(edu-material-generatorのlib/generateOutline.jsと同じ方式)。

function buildScriptSchema() {
  return {
    type: "object",
    properties: {
      videoTitle: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            narration: { type: "string" },
          },
          required: ["text", "narration"],
          additionalProperties: false,
        },
        minItems: 4,
        maxItems: 6,
      },
      youtubeDescription: { type: "string" },
    },
    required: ["videoTitle", "scenes", "youtubeDescription"],
    additionalProperties: false,
  };
}

async function generateScript({ noteTitle, articleText, noteUrl, note }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }
  if (!noteTitle || !noteTitle.trim()) {
    throw new Error("note記事のタイトルが指定されていません。");
  }
  if (!articleText || !articleText.trim()) {
    throw new Error("note記事の本文が指定されていません。");
  }

  const linkGuide = noteUrl
    ? `URL(${noteUrl})を読み上げる必要はないが、「プロフィール欄のリンクから」「概要欄のリンクから」など、視聴者が迷わない案内を入れる`
    : "「プロフィール欄・概要欄のリンクから」など、視聴者が迷わない案内を入れる";

  const prompt = `あなたはYouTube向けの短尺動画(ショート動画)の構成作家です。
以下のnote記事を、その記事へ読者を誘導するための「約30秒のYouTube紹介動画」の台本にしてください。

【note記事タイトル】${noteTitle}
【note記事の本文(全文または抜粋)】
${articleText.slice(0, 6000)}
${noteUrl ? `【note記事の公開URL】${noteUrl}\n` : ""}${note ? `【追加の指示】${note}\n` : ""}
【動画の目的】
この動画はnote記事の「宣伝・入り口」です。記事の結論や核心部分(オチ・具体的な答え)まで話してしまうと、
視聴者がnoteを読む理由がなくなるため、内容を教えすぎず、続きが気になる状態で終わらせてください。

【台本の条件】
- シーンは4〜6個に分割する
- 各シーンに、画面に大きく表示する短い文字(text。8〜18文字程度、体言止めや短い一文でよい)と、
  読み上げるナレーション(narration。口語で自然な一文、1シーンあたり30〜60文字程度)を両方つける
- 全シーンのnarrationを合計すると、日本語の読み上げ速度(1秒あたり約6文字)で30秒前後
  (160〜200文字程度)になるようにする
- 最初のシーンは強いフック(問いかけ・具体的な場面・数字など)で始める
- 最後のシーンは必ず「続きはnoteで」という主旨のCTA(行動喚起)にする。${linkGuide}
- narrationは記事本文のコピペではなく、要約・言い換えで書く
- 誇大な煽り(「絶対に」「今すぐ知らないと損」等)は避け、記事のトーン(実務エピソードに基づく語り口)に合わせた自然な語り口にする

【動画タイトル・概要欄】
- videoTitle: YouTube動画自体のタイトル案(30文字前後)
- youtubeDescription: YouTubeの概要欄用の説明文(2〜3文程度。${noteUrl ? `note記事のURL(${noteUrl})を含める` : "note記事へのリンクを貼る旨を書く"})`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: buildScriptSchema(),
        },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const data = await response.json();

  if (data.stop_reason === "refusal") {
    throw new Error("Claude がこの記事からの台本生成を拒否しました。本文や指示を見直して試してください。");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("生成が長くなりすぎて途中で打ち切られました。もう一度試してください。");
  }

  const textBlock = data.content.find((c) => c.type === "text");
  if (!textBlock) {
    throw new Error("Claude の応答にテキストが含まれていませんでした。");
  }

  let script;
  try {
    script = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(`Claude の応答のJSON解析に失敗しました: ${err.message}`);
  }

  if (!script.videoTitle || !Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error("生成された台本が不完全です(videoTitle/scenesが不足)。");
  }

  script.scenes = script.scenes.map((s) => ({
    text: String(s.text || "").trim(),
    narration: String(s.narration || "").trim(),
  }));

  return script;
}

module.exports = { generateScript };
