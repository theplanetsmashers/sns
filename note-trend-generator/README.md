# noteトレンド分析・ネタ提案ツール(note-trend-generator)

note.comの検索結果から競合・トレンドを分析し、次のnote記事の**ネタ案(タイトル・フック・構成)**をClaude APIで生成してDiscordに届けるツールです。GitHub Actionsで**週次自動実行**され、「トレンドを調べる→分析する→次に書くものを考える」というサイクルを人の代わりに毎週回します。

実際に記事を書く・投稿するかどうかの判断はこれまで通り人間が行います(本文の自動生成・自動投稿は行いません。あくまでネタ出しの壁打ち相手です)。

## 何をするツールか

1. `keywords.json` に登録したキーワードごとに、note.comの検索結果ページ(ログイン不要で閲覧可能)からヒットしている記事のタイトルを収集する
2. 収集したタイトル一覧を材料に、Claude APIで「いま読まれやすい切り口の傾向(トレンド分析)」を要約する
3. トレンド分析を踏まえて、次に書くべきnote記事のネタを3件(タイトル案・フック・構成案)提案する
4. トレンド分析とネタ案をDiscordに通知する
5. 提案したタイトルを履歴(`state/history.json`)に記録し、翌週以降は同じ/似たネタを繰り返し提案しないようにする

## セットアップ

他のツールと共通のシークレットが使えます。未設定の場合はリポジトリの Settings → Secrets and variables → Actions で登録してください。

- `ANTHROPIC_API_KEY`: Claude APIキー(必須)
- `DISCORD_WEBHOOK_URL`: レポートを受け取るDiscordチャンネルのWebhook URL(必須。未設定だとログ出力のみになる)

追加の準備は不要です。`.github/workflows/weekly-note-trend.yml` が毎週月曜(日本時間火曜朝)に自動実行します。GitHubのActionsタブから手動実行(workflow_dispatch)も可能です。

## キーワードのカスタマイズ

`keywords.json` に検索したいキーワードを追加・編集してください。

```json
[
  { "label": "表示用のラベル", "query": "note.comで検索する文字列" }
]
```

初期値は、このリポジトリの発信テーマ(製造業の管理職向け)に合わせたキーワードにしてあります。発信テーマが変わった場合はここを書き換えるだけで分析対象が変わります。

## ローカルでの実行

```bash
cd note-trend-generator
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...  # 任意
npm run generate
```

`state/trend-report-YYYY-MM-DD.json` に、収集した検索結果と生成したレポート全文が保存されます。

## ファイル構成

- `generate-trend-report.js` — キーワードごとの検索→トレンド分析・ネタ提案の生成→Discord通知→履歴保存までを繋ぐメイン処理
- `lib/searchNote.js` — note.comの検索結果ページをヘッドレスブラウザ(Puppeteer)で開き、記事タイトル・URLを取得する。note.comは検索結果をクライアントサイドで描画するため、単純なfetchでは中身が取得できず、Puppeteerで実際にページを開いてDOMから読み取っている
- `lib/generateTrendReport.js` — 収集したタイトル一覧からトレンド分析・次のネタ提案をClaude APIで生成する
- `keywords.json` — 検索キーワードの設定ファイル
- `state/history.json` — 過去に提案したネタのタイトル履歴(直近200件。重複提案を避けるための参考データとして次回生成時に渡す)
- `state/trend-report-*.json` — 実行ごとの生成ログ(収集結果・レポート全文)

## 注意点・既知の制約

- **note.comのDOM構造や、ボット対策(bot detection)の変更に弱い設計です。** 検索結果ページはクライアントサイドレンダリングのため、note.com側の実装変更で取得できなくなる可能性があります。すべてのキーワードで0件だった場合は、正常に分析せずDiscordに警告のみ送って処理を打ち切ります(誤ったトレンド分析を作らないための安全策)。**初回はworkflow_dispatchで手動実行し、Discordに正しくレポートが届くか確認してください。**
- note.comへのアクセスがデータセンターIPからのアクセスとして制限される可能性があります(GitHub ActionsのIPが対象になった場合、検索結果が継続的に0件になることがあります)。その場合は`lib/searchNote.js`の待機時間・セレクタの調整や、別の情報源への切り替えが必要です。
- Threads側の競合投稿は、SNS公式APIが任意の他人の投稿を機械的に収集する用途を想定していないため、このツールでは対象にしていません(comment-generator/README.md参照)。競合Threadsアカウントを見たい場合は、投稿URLを`comment-generator`の仕組み(OGPベストエフォート取得)で個別に確認する運用にしてください。
- Claude APIの呼び出しのみ費用がかかります(テキスト生成のみなので少額)。それ以外(検索・ブラウザ操作)は無料です。

## 今後の拡張案

- `threads-post-generator/generate-posts.js` にはすでに、自分の過去投稿の反応データ(`performance.json`)をプロンプトに反映する仕組み(フェーズ3、未使用)が用意されています。ここにトレンド分析の要約も合わせて渡すようにすると、Threads投稿のテーマ選定にもトレンドが反映されるようになります
- 今は「ネタ提案」止まりですが、選んだネタをそのままnote記事の下書き(見出し構成+各見出しの要点)まで自動生成する「note記事ドラフト生成」機能に発展させることもできます
