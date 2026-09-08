// lib/generateOutline.js
// Claude APIを使って、テーマ名から講義の構成(スライド内容+ナレーション原稿)を丸ごと生成する。
//
// output_config.format(構造化出力)でJSON Schemaを指定し、Claudeの応答が必ずそのスキーマに
// 一致した有効なJSONになることをAPI側で保証させている。以前はマークダウンっぽい応答から
// 正規表現でJSON部分を抜き出していたが、コード例などJSONを壊しやすい内容(バッククォートや
// 引用符)が混じると解析に失敗することがあったため、この方式に切り替えた。

const LAYOUTS = ["list", "process", "callout", "code"];

const { ICON_KEYS } = require("./icons");

function buildSlideSchema() {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      bullets: { type: "array", items: { type: "string" } },
      narration: { type: "string" },
      icon: { type: "string", enum: ICON_KEYS },
      layout: { type: "string", enum: LAYOUTS },
    },
    required: ["title", "bullets", "narration", "icon", "layout"],
    additionalProperties: false,
  };
}

function buildOutlineSchema() {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      objectives: { type: "array", items: { type: "string" } },
      icon: { type: "string", enum: ICON_KEYS },
      slides: { type: "array", items: buildSlideSchema() },
      summary: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          narration: { type: "string" },
          icon: { type: "string", enum: ICON_KEYS },
        },
        required: ["title", "bullets", "narration", "icon"],
        additionalProperties: false,
      },
    },
    required: ["title", "objectives", "icon", "slides", "summary"],
    additionalProperties: false,
  };
}

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
- 内容が「AはBという意味」のような定義や用語説明の場合は、bulletsの文を「用語:説明」の形にすると画面表示で強調されるので、当てはまる場合は積極的にこの形にする

【スライドごとのアイコンとレイアウトの指定】
各スライドには、内容を視覚的にイメージしやすくするためのアイコン(icon)と、表示形式(layout)を指定すること。

- icon: そのスライドの内容に最も合うものを1つだけ選ぶこと
- layout: 次の4つから選ぶこと
  - "list": 通常の箇条書き(デフォルト。迷ったらこれ)
  - "process": bulletsが「手順1→手順2→手順3」のような明確な順序を持つ2〜4ステップの場合だけ選ぶ(横に並ぶステップ図になる)
  - "callout": このスライドで伝えたいことが1つの重要な注意点・警告・強調メッセージに絞られる場合に選ぶ(bulletsは1〜2個程度にする)
  - "code": プログラミングのコード例・コマンド例・関数の書式など、コード表記そのものを見せたい場合だけ選ぶ(ターミナル風の見た目になる。bulletsにはコードや数式をそのまま書く)`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: buildOutlineSchema(),
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
    throw new Error("Claude がこのテーマの生成を拒否しました。テーマを変えて試してください。");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("生成が長くなりすぎて途中で打ち切られました。スライド枚数を減らして試してください。");
  }

  const textBlock = data.content.find((c) => c.type === "text");
  if (!textBlock) {
    throw new Error("Claude の応答にテキストが含まれていませんでした。");
  }

  let outline;
  try {
    // output_config.format(構造化出力)により、このテキストは指定したJSON Schemaに
    // 一致する有効なJSONであることがAPI側で保証されている。
    outline = JSON.parse(textBlock.text);
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
    icon: s.icon,
    layout: s.layout,
  }));

  return outline;
}

module.exports = { generateOutline, LAYOUTS };
