# note/SNS 投稿の下書き自動生成

このリポジトリには2つのツールがあります。

1. **Threads投稿案 自動生成**(フェーズ1) — 「会社の裏設定」シリーズの記事台帳(243テーマ)を元に、毎日Threadsの投稿案をClaude APIで自動生成し、Discordに通知
2. **マルチSNS下書き工場** — note記事を1本書いたら、そこからフックの効いたThreads投稿文・X投稿文を自動生成し、Discordにコピーしやすい形で通知

どちらも投稿は自動では行わず、案の中から選んで手動投稿する運用です。

## セットアップ手順

1. このフォルダをGitHubリポジトリ(新規 or 既存)に丸ごとpushする
2. リポジトリの Settings → Secrets and variables → Actions で以下を登録
   - `ANTHROPIC_API_KEY`: Claude APIキー(claude.aiのサブスクとは別課金なので注意)
   - `DISCORD_WEBHOOK_URL`: 投稿案を受け取るDiscordチャンネルのWebhook URL
3. Actionsタブで以下の2つが表示されることを確認
   - `Daily Threads Post Draft Generator` — 毎日 日本時間6:00 に自動実行(cronは `.github/workflows/daily-threads-posts.yml` で調整可能)。`workflow_dispatch` で今すぐ手動実行も可能
   - `Note SNS Draft Generator` — `articles/` フォルダに `.md` ファイルをpushすると自動実行(詳細は下記)

## Threads投稿案 自動生成(フェーズ1)

- `themes.json` — 記事台帳から抽出したネタ元(タイトル・テーマ・教訓・キーワード)。243件
- `generate-posts.js` — 投稿案を生成するメインスクリプト
- `state/used-themes.json` — 使用済みテーマのID記録(重複を避けるため。全部使い切ったら自動的にリセットされる)
- `state/performance.json` — (フェーズ3で追加予定)過去投稿の反応データ。今はまだ存在しないので空扱いになる
- `state/generated-YYYY-MM-DD.json` — 実行ごとの生成ログ

## マルチSNS下書き工場

note記事を書き終えたら、その本文からフックの効いたThreads投稿文・X投稿文を1本ずつ自動生成し、
Discordにコードブロック(タップ/クリックでワンタップコピーできる形式)で通知します。

**使い方**

1. 書き終えたnote記事の本文を `articles/` フォルダに `.md` ファイルとして置いてpushする(詳細は `articles/README.md` 参照)
2. GitHub Actionsの `Note SNS Draft Generator` が自動的に動き、Discordに以下が届く
   - Threads用の投稿文(コードブロック → タップでコピー)
   - X用の投稿文(コードブロック → タップでコピー)
3. note自体への投稿は、この仕組みとは別に好きなタイミングで手動で行う
4. Threads・Xへの投稿も、コピーした文章を貼り付けて手動で行う

- `generate-sns-drafts.js` — note記事からThreads/X下書きを生成し、Discordに通知するスクリプト
- `.github/workflows/note-sns-drafts.yml` — `articles/**.md` のpushで自動実行するワークフロー。`article_path` を指定して手動実行(再生成)も可能
- `state/sns-drafts-<記事名>.json` — 生成した下書きのログ

## 今後の拡張ポイント(フェーズ2以降)

- **フェーズ2(返信自動生成)**: Threads公式Graph APIでコメントを取得し、`generate-posts.js`と同様の構成で返信案を生成 → Discord通知 → 手動投稿
- **フェーズ3(反応検知フィードバック)**: Threads APIから投稿ごとのいいね数・リプライ数を日次取得し `state/performance.json` に記録する別ワークフローを追加。`generate-posts.js`はこのファイルを自動で読み込み、プロンプトに反映する仕組みは既に組み込み済み
- **フェーズ4(自走化)**: 承認ステップを外し、生成したdraftsをそのままThreads APIで自動投稿するよう`postToDiscord`部分を`postToThreads`に置き換える

## 注意点

- Threads公式APIは投稿・返信の自動化が許可されています(過去に検討したRakuten ROOMやXアフィリエイトのブラウザ自動化とは異なり、公式APIベースなのでToS上の問題は基本的にありません)。ただし高頻度・スパム的な投稿はプラットフォームの検知対象になり得るため、1日の投稿数・返信数は節度を持たせてください
- `POSTS_PER_DAY` はワークフローのenvで変更可能です
