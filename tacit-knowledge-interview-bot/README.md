# 暗黙知インタビューボット(MVP)

製造業の管理職・ベテラン技能者が持つ暗黙知を対話形式で引き出し、1回のインタビューから

- 社内向け技術継承マニュアル(PFMEA的な留意点込み、ハルシネーション検査つき二段階生成)
- 研修用ケーススタディ(判断プロセスを追体験できる形式)
- note/ブログ用の一般公開記事

の3種類を自動生成するMVPです。`threads-post-generator` と同じく、Node.jsからClaude APIを直接呼び出すシンプルな構成で、依存パッケージなし(Node.js 18+ 標準の `fetch` / `crypto` / `http` のみ)で動きます。

CLI(ターミナル)とSlack Botの両方から同じインタビューを実施でき、対話ロジックは `lib/interview-engine.js` に共通化されています。

## セットアップ

1. `ANTHROPIC_API_KEY` を環境変数に設定する(claude.aiのサブスクとは別課金なので注意)
   ```
   export ANTHROPIC_API_KEY=sk-ant-xxxx
   ```
2. (任意)生成完了をDiscord/Slackに通知したい場合は `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` も設定する
3. (任意)Google Driveへの自動アップロードを使う場合は下記「Google Drive連携」を参照
4. (任意)Slack Bot経由でインタビューしたい場合は下記「Slack Bot」を参照
5. このディレクトリで `npm install` は不要

## 使い方

### 1. インタビューを実施する(対話モード)

```
npm run interview
```

「社内利用に同意するか」「社外公開(note/ブログ)に同意するか」「所属部署(任意)」を確認したうえで、質問テンプレートに沿って質問が表示されます。回答はターミナルに複数行入力でき、空行で入力終了です。回答が抽象的だとClaudeが深掘り質問を1つ追加し、その場で暗黙知ポイントの要約と「濃さ(1〜5)」を表示します。

社内利用に同意しない場合はその場でインタビューを中止し、記録は保存されません。

終了すると `sessions/` 配下にインタビュー記録がJSONで保存され、最後に「内容が抽象的だったカテゴリ」の一覧が表示されます(次回セッションで深掘りする際の目安になります)。

### 2. テンプレートを選ぶ・自動生成する

```
npm run interview -- --list-templates
npm run interview -- --template=general-tacit-knowledge
```

- `manufacturing-supervisor`(デフォルト): 製造業の現場管理職向け(五感的な手がかりの質問を含む)
- `general-tacit-knowledge`: 業種を問わない汎用版(営業・接客・管理部門など)

新しい職種向けのテンプレートは手で書く代わりにClaudeに生成させることもできます。

```
npm run template -- --role="コールセンターのオペレーター" --name=call-center
```

`templates/call-center.json` が生成され、そのまま `--template=call-center` で使えます。

### 3. 中断したインタビューを再開する

回答は質問ごとに `sessions/` へ即時保存されるため、途中で終了しても失われません。

```
npm run interview -- --resume=sessions/2026-XX-XX..._topic.json
```

未回答の質問だけが再開されます。

### 4. 非対話モード(CI・自動テスト・外部連携向け)

事前に用意した回答ファイル(`examples/sample-answers.json` を参照)を使って、ターミナル入力なしで一気通貫に実行できます。

```
npm run interview -- --answers=examples/sample-answers.json \
  --interviewee="山田さん" --topic="プレス加工の金型交換" \
  --consent-internal=yes --consent-public=no
```

### 5. アウトプットを生成する

```
npm run outputs -- sessions/2026-XX-XXTXX-XX-XX-XXXZ_topic.json
```

マニュアルは「ドラフト生成 → 別のClaude呼び出しでのレビュー(インタビュー記録にない事実の混入がないかチェック)」という二段階で生成し、`outputs/<セッション名>/manual.draft.md`(レビュー前)と `manual.md`(レビュー後・最終版)の両方を残します。`case-study.md`(研修ケース)も生成されます。`article.md`(note/ブログ記事)は、インタビュー時に社外公開への同意があった場合のみ生成されます。

`DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` / Google Drive連携(下記)を設定していれば、生成完了時に自動で通知・アップロードされます。

### 6. セッション一覧を確認する

```
npm run sessions
```

対象者・テーマ・進捗(何問中何問回答済みか)・同意状況を一覧表示します。

### 7. 組織横断の「暗黙知マップ」ダッシュボードを見る

```
npm run dashboard
```

`sessions/` 配下の全インタビューを横断集計し、部門別の平均スコア・カテゴリ別の平均スコア・要フォローアップ一覧(濃さ2以下)を可視化した `outputs/dashboard.html` を生成します。ブラウザで開いて確認してください。法人向け(人事・技能伝承部門)に「どこが手薄か」を一目で見せる想定の機能です。

## Google Drive連携(任意)

インタビュー記録とアウトプットを、対象者名>セッションのフォルダ構造で自動アップロードできます。

1. Google Cloudでサービスアカウントを作成し、JSONキーを発行する
2. アップロード先にしたいDriveフォルダ(「ペルソナ・体験」フォルダなど)を、サービスアカウントのメールアドレスに編集者として共有する
3. 環境変数を設定する
   ```
   export GOOGLE_SERVICE_ACCOUNT_KEY='{"client_email": "...", "private_key": "..."}'   # JSONキーを1行文字列にしたもの
   export GOOGLE_DRIVE_ROOT_FOLDER_ID=共有したフォルダのID
   ```
4. `npm run outputs -- <セッションファイル>` を実行すると、生成完了後に自動でアップロードされます

依存パッケージ(`googleapis`など)は使わず、Node標準の `crypto` でサービスアカウントのJWT署名・OAuthトークン取得を行い、Drive REST APIを直接呼んでいます(`lib/google-drive.js`)。

## Slack Bot(任意)

ターミナルの代わりにSlack上でインタビューを進行できます。ロジックはCLIと共通(`lib/interview-engine.js`)で、`slack-bot/conversation.js` がSlack向けの会話状態を管理します。

1. https://api.slack.com/apps でアプリを作成
2. Bot Token Scopes に `chat:write`, `im:history`, `im:write`, `users:read` を追加してワークスペースにインストールし、Bot User OAuth Token(`xoxb-...`)を取得
3. Slash Command `/interview` を作成し、Request URL を `https://<公開URL>/slack/commands` に設定
4. Event Subscriptions を有効化し、Request URL を `https://<公開URL>/slack/events` に設定(`message.im` を購読)
5. 環境変数を設定してサーバーを起動
   ```
   export SLACK_BOT_TOKEN=xoxb-...
   export SLACK_SIGNING_SECRET=...
   npm run slack-bot
   ```
6. サーバーは常時稼働・外部公開(ngrokや実サーバー等)が必要です

Slackでの流れ: `/interview` (または `/interview <テンプレート名>`) でBotとのDMにインタビューが開始され、以降はDMで質問に答えていくだけでCLIと同じ「深掘り判定→要約→濃さ評価」が行われます。`/interview cancel` で中断できます。

## ファイル構成

- `lib/interview-engine.js` — 対話ロジックの中核(テンプレート読み込み・Claude呼び出し・回答分析)。CLIとSlack Botで共有
- `lib/google-drive.js` — Google Drive(サービスアカウント)へのアップロード処理
- `templates/` — インタビューの質問テンプレート(業種・職種別に複数持てる。`generate-template.js`で自動生成も可能)
- `interview.js` — インタビューCLI(対話/非対話/再開に対応)
- `generate-template.js` — 役割名からテンプレートをClaudeに生成させるCLI
- `generate-outputs.js` — セッション記録から3種類のアウトプットを生成するスクリプト(二段階生成・同意チェック・通知・Drive連携込み)
- `generate-dashboard.js` — 全セッション横断の暗黙知マップHTMLダッシュボードを生成
- `list-sessions.js` — セッション一覧・進捗確認用ユーティリティ
- `slack-bot/` — Slack Bot本体(`server.js` = HTTPサーバー, `conversation.js` = 会話状態機械, `slack-client.js` = Slack Web APIラッパー)
- `examples/sample-answers.json` — 非対話モード用の回答サンプル(動作確認・自動テストにも利用)
- `sessions/` — インタビュー記録(gitignore対象。個人情報・社外秘の可能性があるためコミットしない)
- `outputs/` — 生成されたマニュアル/ケース/記事/ダッシュボード(同上、gitignore対象)

## プライバシー・同意の扱い

インタビュー開始時に「社内利用への同意」「社外公開への同意」を必ず確認します(CLI・Slack Bot共通)。

- 社内利用に同意がない場合 → インタビュー自体を中止し、記録も保存しません
- 社外公開に同意がない場合 → マニュアル・研修ケースは生成しますが、note/ブログ記事は生成しません

`sessions/` と `outputs/` はどちらもgitignore対象です。Google Driveにアップロードする場合も、同意情報(`consent`フィールド)を含むセッションJSONごと保存されるため、後から利用範囲を確認できます。

## MVPとしての検証ステップ

1. まず自分自身の別のエピソード(例: 係長時代の別の判断場面など)で一度インタビューを回し、質問テンプレートと深掘り判定の精度を確認する
2. 精度に問題がなければ、他の製造業管理職に試してもらい、生成物の実用性(マニュアルとして使えるか、記事として公開できるか)を検証する
3. 濃さスコアが低いカテゴリだけを対象に、同じセッションを `--resume` で深掘りし直す運用を試す
4. マニュアルの `manual.draft.md` と `manual.md` を見比べて、レビュー段階がどんな修正をしているか確認する

## 今後の拡張ポイント

- 個人向け(退職前ベテラン向け月額ツール)/法人向け(人事・技能伝承部門への導入、インタビュー代行込み)でプラン分岐
- 既存note読者向けに「あなたの経験を記事にしませんか」という追加サービスとして提供する導線を用意する
- ダッシュボードの時系列比較(同じ人・同じカテゴリのスコアが継承活動でどう改善したか)
- Slack Botのマルチワークスペース対応(現状は1インスタンス1ワークスペース想定のシンプルな作り)
