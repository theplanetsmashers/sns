# 伸びている投稿への自動コメント返信(フェーズ3+4)

自分のThreads投稿の中から「伸びている投稿」を定期的に検出し、そこに届いたコメントへ短文の返信をClaude APIで生成して**自動投稿**するボットです。

`threads-post-generator`(投稿案の生成のみ)・`comment-generator`(他人の投稿への返信案の生成のみ)とは異なり、このツールは**人間の承認ステップなしで実際にThreadsへ返信を投稿します**。自分の投稿に届いたコメントへの返信は、Threads公式APIが想定している通常の利用範囲内の操作です。

## 仕組み

GitHub Actionsが30分おきに(`.github/workflows/threads-growth-autoreply.yml`)以下を実行します。

1. 自分の直近の投稿一覧を取得(`POST_LOOKBACK_HOURS` 時間以内に投稿したもの)
2. 投稿ごとの閲覧数などのインサイトを取得し、前回チェック時からの増分で「伸びている」かを判定
   - 増分が `GROWTH_MIN_VIEWS_DELTA` 以上、または増加率が `GROWTH_MIN_RATE` 以上なら「伸びている」と判定
   - 一度「伸びている」と判定された投稿は `GROWTH_STICKY_HOURS` 時間の間、コメント返信の対象であり続ける(伸び始め直後のコメントを取りこぼさないため)
3. 対象の投稿に届いた未返信コメントを取得し、コメントごとにClaude APIで40文字以内の短い返信文を1本生成
4. Threads APIでそのコメントへの返信として自動投稿
5. 結果をDiscordに通知(事後報告。承認は求めない)

1回の実行あたりの返信数には上限(`MAX_REPLIES_PER_RUN` / `MAX_REPLIES_PER_POST_PER_RUN`)を設けており、スパム的な連投にならないようにしています。

## セットアップ

### 1. Threads APIのアクセストークンを取得する

Threads APIは、投稿・コメント取得・自分の投稿への返信を公式にサポートしています。以下の手順で自分のアカウント用のアクセストークンを取得してください。

1. [Meta for Developers](https://developers.facebook.com/) でアプリを作成し、「Threads API」のユースケースを追加する
2. アプリの設定で、返信の自動化に必要な権限(スコープ)を有効にする
   - `threads_basic`
   - `threads_content_publish`
   - `threads_read_replies`
   - `threads_manage_replies`
   - `threads_manage_insights`
3. Threadsアカウントの認可フロー(OAuth)を通して、自分のアカウントでログインし短期アクセストークンを取得する
4. 短期トークンを長期トークン(60日間有効)に交換する(`GET https://graph.threads.net/access_token?grant_type=th_exchange_token&...`)
5. 長期トークンは60日で失効するため、定期的に `GET https://graph.threads.net/refresh_access_token` で更新し、GitHub Secretsを更新し直す運用にする(現時点でこのリポジトリには自動更新の仕組みはないため、カレンダーリマインダーなどで手動更新することを推奨)

手順の詳細やUIは変更される可能性があるため、最新情報は必ずMeta公式のThreads APIドキュメントを参照してください。

### 2. GitHub Secretsを登録する

リポジトリの Settings → Secrets and variables → Actions で以下を登録します。

- `THREADS_ACCESS_TOKEN`: 上記で取得したThreadsアクセストークン(必須)
- `THREADS_USER_ID`: 自分のThreadsユーザーID(任意。未設定でもアクセストークンから自動解決を試みる)
- `ANTHROPIC_API_KEY`: Claude APIキー(`threads-post-generator`用に登録済みなら共用可)
- `DISCORD_WEBHOOK_URL`: 通知を受け取るDiscordチャンネルのWebhook URL(共用可)

### 3. 動作確認

Actionsタブで `Threads Growth Auto Reply` を選び、`workflow_dispatch`(手動実行ボタン)で1回実行して、エラーなく完了することとDiscord通知を確認してください。

## 設定値(環境変数)

ワークフローの `env` で調整できます。

| 変数名 | デフォルト | 説明 |
| --- | --- | --- |
| `POST_LOOKBACK_HOURS` | `72` | この時間以内に投稿されたものだけを監視対象にする |
| `GROWTH_MIN_VIEWS_DELTA` | `50` | 前回チェック時からの閲覧数増分がこの値以上なら「伸びている」と判定 |
| `GROWTH_MIN_RATE` | `0.2` | 前回チェック時からの閲覧数増加率(20%)がこの値以上でも「伸びている」と判定 |
| `GROWTH_STICKY_HOURS` | `24` | 「伸びている」判定後、返信対象であり続ける時間 |
| `MAX_REPLIES_PER_RUN` | `5` | 1回の実行での自動返信数の上限(全投稿合計) |
| `MAX_REPLIES_PER_POST_PER_RUN` | `3` | 1回の実行で1投稿に対して返信するコメント数の上限 |
| `REPLY_TONE` | (空) | 返信のトーン指定(例: `フランクで絵文字多め`) |

## ファイル構成

- `bot.js` — メイン処理(GitHub Actionsから定期実行)
- `lib/threadsApi.js` — Threads Graph APIのラッパー(投稿取得・インサイト取得・コメント取得・返信投稿)
- `lib/growth.js` — 「伸びている投稿」判定ロジック
- `lib/generateReply.js` — Claude APIでコメントへの短文返信を1本生成する処理
- `lib/state.js` — インサイト履歴・返信履歴の読み書き
- `state/snapshots.json` — 投稿ごとのインサイト履歴(伸び判定に使用)
- `state/replied.json` — 返信済みコメントの記録(直近500件。重複返信防止と、似た言い回しを避けるための参考データ)

## 注意点・既知の制約

- **完全自動投稿です。** 生成された返信文は人間の確認なしにそのままThreadsへ投稿されます。意図しない返信が続く場合は、GitHub Actionsの `Threads Growth Auto Reply` ワークフローを無効化するか、`MAX_REPLIES_PER_RUN` を `0` にしてください。
- Threads APIのアクセストークンは60日で失効します。失効するとワークフローがエラーになるので、Discord通知やActionsの実行結果を定期的に確認してください。
- Threads APIには投稿・返信のレート制限があります。デフォルト設定は控えめですが、アカウントの状況に応じて調整してください。
- インサイト(閲覧数など)は投稿直後は取得できないことがあります。その場合はその回の判定をスキップし、次回以降のチェックに引き継がれます。
- コメント一覧取得は1回のAPI呼び出しで取得できる範囲(先頭ページ)のみを対象にしています。大量のコメントが一度に届くバズり方をした投稿では、すべてのコメントに追いつくまで複数回の実行にまたがる場合があります。
