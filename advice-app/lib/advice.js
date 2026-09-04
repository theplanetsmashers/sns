'use strict';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_BODY_CHARS = 4000;

function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return `${text.slice(0, max)}…(以下省略)`;
}

function buildArticleBlock(article, index) {
  const label = article.noteNumber ? `#${article.noteNumber} ` : '';
  const paidNote = article.notePrice > 0 ? '（note.com有料記事）' : '';
  return [
    `[記事${index + 1}] ${label}${article.title}${paidNote}`,
    `URL: ${article.url}`,
    '本文:',
    truncate(article.body, MAX_BODY_CHARS),
  ].join('\n');
}

function buildPrompt(concern, matches) {
  const articleBlocks = matches
    .map((m, i) => buildArticleBlock(m.article, i))
    .join('\n\n---\n\n');

  return [
    'あなたは、製造業の管理職としての実体験に基づくエッセイシリーズ「会社の裏設定」の内容を踏まえて',
    '仕事の悩みにアドバイスするアシスタントです。',
    '',
    '以下は、ユーザーの悩みに関連すると判断された実際の記事です。これらの記事の具体的なエピソードや',
    '考え方に必ず言及しながら、一般論だけで終わらせずに実践的なアドバイスを日本語で書いてください。',
    '',
    '# 参考記事',
    articleBlocks,
    '',
    '# ユーザーの悩み',
    concern,
    '',
    '# 出力ルール',
    '- まずユーザーの悩みへの共感を一言添える。',
    '- 次に、参考記事のどの部分が今回の悩みに関係するかを具体的に引用・要約しながら説明する。',
    '- 記事の考え方を、ユーザーの状況にどう当てはめられるかを具体的に提案する。',
    '- 最後に「参照した記事」として、使った記事番号とタイトルを箇条書きで挙げる。',
    '- 参考記事に書かれていない一般論に頼りすぎない。記事に根拠がない場合はその旨を正直に述べる。',
  ].join('\n');
}

async function generateAdvice(concern, matches) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { mode: 'fallback', text: null };
  }

  const prompt = buildPrompt(concern, matches);

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return { mode: 'llm', text };
}

module.exports = { generateAdvice, buildPrompt };
