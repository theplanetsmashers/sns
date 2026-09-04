# note/SNS 投稿の下書き自動生成

このリポジトリには2つのツールがあります。

1. **Threads投稿案 自動生成**(フェーズ1) — 「会社の裏設定」シリーズの記事台帳(243テーマ)を元に、毎日Threadsの投稿案をClaude APIで自動生成し、Discordに通知
2. **SNS下書き工場**(Webアプリ) — note記事を貼り付けると、フックの効いたThreads投稿文・X投稿文をその場で自動生成し、コピーボタン付きの履歴として並べて表示

どちらも投稿は自動では行わず、案の中から選んで手動投稿する運用です。

## Threads投稿案 自動生成(フェーズ1)

GitHub Actionsで毎日自動実行し、Discordに投稿案を通知します。

**セットアップ**

1. このフォルダをGitHubリポジトリ(新規 or 既存)に丸ごとpushする
2. リポジトリの Settings → Secrets and variables → Actions で以下を登録
   - `ANTHROPIC_API_KEY`: Claude APIキー(claude.aiのサブスクとは別課金なので注意)
   - `DISCORD_WEBHOOK_URL`: 投稿案を受け取るDiscordチャンネルのWebhook URL
3. Actionsタブで `Daily Threads Post Draft Generator` が表示されることを確認
   - 毎日 日本時間6:00 に自動実行(cronは `.github/workflows/daily-threads-posts.yml` で調整可能)
   - `workflow_dispatch` で今すぐ手動実行も可能

**ファイル構成**

- `themes.json` — 記事台帳から抽出したネタ元(タイトル・テーマ・教訓・キーワード)。243件
- `generate-posts.js` — 投稿案を生成するメインスクリプト
- `state/used-themes.json` — 使用済みテーマのID記録(重複を避けるため。全部使い切ったら自動的にリセットされる)
- `state/performance.json` — (フェーズ3で追加予定)過去投稿の反応データ。今はまだ存在しないので空扱いになる
- `state/generated-YYYY-MM-DD.json` — 実行ごとの生成ログ

**今後の拡張ポイント(フェーズ2以降)**

- **フェーズ2(返信自動生成)**: Threads公式Graph APIでコメントを取得し、`generate-posts.js`と同様の構成で返信案を生成 → Discord通知 → 手動投稿
- **フェーズ3(反応検知フィードバック)**: Threads APIから投稿ごとのいいね数・リプライ数を日次取得し `state/performance.json` に記録する別ワークフローを追加。`generate-posts.js`はこのファイルを自動で読み込み、プロンプトに反映する仕組みは既に組み込み済み
- **フェーズ4(自走化)**: 承認ステップを外し、生成したdraftsをそのままThreads APIで自動投稿するよう`postToDiscord`部分を`postToThreads`に置き換える

**注意点**

- Threads公式APIは投稿・返信の自動化が許可されています(過去に検討したRakuten ROOMやXアフィリエイトのブラウザ自動化とは異なり、公式APIベースなのでToS上の問題は基本的にありません)。ただし高頻度・スパム的な投稿はプラットフォームの検知対象になり得るため、1日の投稿数・返信数は節度を持たせてください
- `POSTS_PER_DAY` はワークフローのenvで変更可能です

## SNS下書き工場(Webアプリ)

note記事を貼り付けると、フックの効いたThreads投稿文・X投稿文をその場で生成するツールです。
GitHubの操作(Secrets登録やActionsの実行)は一切不要で、スマホのブラウザだけで完結します。

公開URL: https://claude.ai/code/artifact/5d82b75c-0516-46b5-9934-e5d76ab79f8b

**使い方**

1. 上記URLを開き、note記事の本文をテキストエリアに貼り付けて「生成する」をタップ
2. 初回はClaudeの利用許可を求められるので許可する(APIキーの登録は不要。自分のClaude利用枠が使われます)
3. note・Threads・Xの3列が横並びで表示され、生成した下書きはThreads/X列にコピーボタン付きで並ぶ
4. 縦方向には過去の生成履歴が並ぶので、前回・今回・次回の流れを見返せる
5. note・Threads・Xへの実際の投稿は、それぞれ別のタイミングで手動で行う

- ソース: `webapp/sns-draft-factory.html`(Claude Artifactとして公開。同じファイルを再公開すると同じURLが更新される)
- 文体・長さの見本(Threads/X参考例)は画面下部の「文体サンプルを編集する」から差し替え可能
- 履歴はブラウザのlocalStorageに保存されるため、この端末・このブラウザだけのものです(他の端末とは共有されません)
