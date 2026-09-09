// lib/generateScript.js
// Claude APIを使って、note記事の本文から「約30秒のYouTube紹介動画」の台本を生成する。
// output_config.format(構造化出力)でJSON Schemaを指定し、応答が必ずスキーマに一致することを
// API側で保証させている(edu-material-generatorのlib/generateOutline.jsと同じ方式)。

const { ICON_KEYS } = require("./icons");

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
            icon: { type: "string", enum: ICON_KEYS },
            imagePrompt: { type: "string" },
          },
          required: ["text", "narration", "icon", "imagePrompt"],
          additionalProperties: false,
        },
        // Claude APIの構造化出力(json_schema)は、配列のminItems/maxItemsに0か1以外の値を
        // 指定できない(4件のシーン数などをここで強制できない)ため、シーン数はプロンプト側の
        // 指示のみで制御し、生成後にcode側でチェックする。
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
- 各シーンに、画面中央に大きく表示する短い文字(text)と、読み上げるナレーション(narration。
  口語で自然な一文、1シーンあたり30〜60文字程度)を両方つける
- textは人気のショート動画のテロップに合わせ、1行あたり全角14文字程度を目安にし、
  長くても2行(28文字程度)以内に収める。読点(、)や句点(。)は入れない(体言止めや短い一文で、
  「朝6時半、検査ラインで」のように読点なしでも自然に読めるフレーズにする)
- 全シーンのnarrationを合計すると、日本語の読み上げ速度(1秒あたり約6文字)で30秒前後
  (160〜200文字程度)になるようにする
- 最初のシーンは、最初の1〜2秒で視聴者の指を止める強いフック(問いかけ・具体的な場面・数字など)
  で始める
- 最後のシーンは必ず「続きはnoteで」という主旨のCTA(行動喚起)にする。${linkGuide}
- narrationは記事本文のコピペではなく、要約・言い換えで書く
- 誇大な煽り(「絶対に」「今すぐ知らないと損」等)は避け、記事のトーン(実務エピソードに基づく語り口)に合わせた自然な語り口にする

【各シーンの背景の絵】
テキストだけの画面にならないよう、各シーンには背景の絵を敷く。そのために2つの情報を付ける。

- icon: 次の候補から、そのシーンの内容に最も近いものを1つ選ぶ(AI画像生成を使わない場合の
  装飾アイコンとして使う)。候補: ${ICON_KEYS.join(", ")}
- imagePrompt: AI画像生成に渡す、そのシーンの場面を表す短い英語の説明(15語程度)。
  実写のドキュメンタリー風写真として描写すること(イラストやアニメ風ではなく、自然光の中の
  実際の職場・工場のワンシーンのような写真らしい描写にする)。文字・数字・ロゴを画像に
  含めないこと。実在の人物や会社が特定できる描写は避け、一般化した職場・オフィス・工場などの
  場面として描写する

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
  if (script.scenes.length < 3 || script.scenes.length > 8) {
    throw new Error(
      `生成されたシーン数が想定外です(${script.scenes.length}件)。もう一度試してください。`
    );
  }

  script.scenes = script.scenes.map((s) => ({
    text: String(s.text || "").trim(),
    narration: String(s.narration || "").trim(),
    icon: ICON_KEYS.includes(s.icon) ? s.icon : "note",
    imagePrompt: String(s.imagePrompt || "").trim(),
  }));

  return script;
}

module.exports = { generateScript };
