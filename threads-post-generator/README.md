# Threads 投稿案 自動生成(フェーズ1)

「会社の裏設定」シリーズの記事台帳(243テーマ)を元に、毎日Threadsの投稿案をClaude APIで自動生成し、Discordに通知します。投稿は自動では行わず、案の中から選んで手動投稿する運用です。

## セットアップ手順

1. リポジトリの Settings → Secrets and variables → Actions で以下を登録
   - `ANTHROPIC_API_KEY`: Claude APIキー(claude.aiのサブスクとは別課金なので注意)
   - `DISCORD_WEBHOOK_URL`: 投稿案を受け取るDiscordチャンネルのWebhook URL
2. Actionsタブで `Daily Threads Post Draft Generator` が表示されることを確認
   - 毎日 日本時間6:00 に自動実行(cronは `../.github/workflows/daily-threads-posts.yml` で調整可能)
   - `workflow_dispatch` があるので、今すぐ手動実行して動作確認もできる

## ファイル構成

- `themes.json` — 記事台帳から抽出したネタ元(タイトル・テーマ・教訓・キーワード)。243件
- `generate-posts.js` — 投稿案を生成するメインスクリプト
- `state/used-themes.json` — 使用済みテーマのID記録(重複を避けるため。全部使い切ったら自動的にリセットされる)
- `state/performance.json` — (フェーズ3で追加予定)過去投稿の反応データ。今はまだ存在しないので空扱いになる
- `state/generated-YYYY-MM-DD.json` — 実行ごとの生成ログ

## 今後の拡張ポイント(フェーズ2以降)

- **フェーズ2(返信自動生成)**: Threads公式Graph APIでコメントを取得し、`generate-posts.js`と同様の構成で返信案を生成 → Discord通知 → 手動投稿
  - このうち「他の人の投稿へのコメント文を作る」部分は `../comment-generator/` として実装済み(詳細はそちらのREADME参照)
- **フェーズ3(反応検知フィードバック)**: Threads APIから投稿ごとのいいね数・リプライ数を日次取得し `state/performance.json` に記録する別ワークフローを追加。`generate-posts.js`はこのファイルを自動で読み込み、プロンプトに反映する仕組みは既に組み込み済み
- **フェーズ4(自走化)**: 承認ステップを外し、生成したdraftsをそのままThreads APIで自動投稿するよう`postToDiscord`部分を`postToThreads`に置き換える

## 注意点

- Threads公式APIは投稿・返信の自動化が許可されています(過去に検討したRakuten ROOMやXアフィリエイトのブラウザ自動化とは異なり、公式APIベースなのでToS上の問題は基本的にありません)。ただし高頻度・スパム的な投稿はプラットフォームの検知対象になり得るため、1日の投稿数・返信数は節度を持たせてください
- `POSTS_PER_DAY` はワークフローのenvで変更可能です
