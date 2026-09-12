# noteトレンド分析・ネタ提案ツール(note-trend-generator)

note.comの検索結果から競合・トレンドを分析し、次のnote記事の**ネタ案(タイトル・フック・構成)**をClaude APIで生成してDiscordに届けるツールです。GitHub Actionsで**週次自動実行**され、「トレンドを調べる→分析する→次に書くものを考える」というサイクルを人の代わりに毎週回します。

実際に記事を書く・投稿するかどうかの判断はこれまで通り人間が行います(本文の自動生成・自動投稿は行いません。あくまでネタ出しの壁打ち相手です)。

## 何をするツールか

1. `keywords.json` に登録したキーワードごとに、note.comの検索結果ページ(ログイン不要で閲覧可能)からヒットしている記事のタイトルを収集する
2. 収集したタイトル一覧を材料に、Claude APIで「いま読まれやすい切り口の傾向(トレンド分析)」を要約する
3. トレンド分析を踏まえて、次に書くべきnote記事のネタを3件(タイトル案・フック・構成案)提案する
4. トレンド分析とネタ案をDiscordに通知する
5. 提案したタイトルを履歴(`state/history.json`)に記録し、翌週以降は同じ/似たネタを繰り返し提案しないようにする
6. 実際に書き上げたnote記事(`state/published-articles.json`)も合わせてプロンプトに渡し、「もう書いたテーマ」を避けてネタを提案する(下記「Notionとの連携」参照。以前はGoogle Driveの執筆記録を使っていたが、現在はNotionのDBを一次情報源としている)

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

## note記事の執筆記録との連携

過去記事(#193〜#215)はもともとGoogle DriveにMarkdownファイルとして書き溜めていましたが、2026-09-12にすべてNotionのデータベース「note記事DB(会社の裏設定)」へ移行しました。**以後の新規記事はNotionのこのDBに直接書いていく運用**とし、`state/published-articles.json`はNotion側の内容を一次情報源として同期します(Google Drive側の仕組みは過去記事の参照用として残していますが、新規追記は行いません)。

### Notionとの連携(sync-notion-articles.js)— 現在の運用

`sync-notion-articles.js` が**GitHub Actionsで定期実行**され、Notionの「note記事DB(会社の裏設定)」に登録されている記事一覧を取得して`state/published-articles.json`をまるごと書き換えます。これにより、`generate-trend-report.js`のネタ提案が既存記事と被らないようになります(上記「【すでに公開済みの自分のnote記事】」として毎回プロンプトに渡される)。

処理の流れ:

1. Notion Internal Integrationトークン(`NOTION_API_KEY`)を使い、Notion API(`POST /v1/databases/{database_id}/query`)でDBの全ページを取得する(`lib/notionApi.js`。ページネーション対応)
2. 各ページのプロパティ(`Name`・`番号`・`ステータス`・`作成日`)から、記事タイトル(連載名・番号部分は除いた本文タイトルのみ)・番号・ステータス・NotionページID・作成日を取り出す
3. 番号順にソートし、`state/published-articles.json`を丸ごと置き換える(Drive版のような差分追記ではなく、Notionの現在の内容を毎回そのまま反映するフルシンク)
4. (ワークフロー側で)変更をコミット・push する

#### セットアップ(Notion Internal Integration)

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) で「新しいインテグレーション」を作成する(ワークスペースを選択するだけでよい。無料)
2. 作成後に表示される「Internal Integration Secret」(`ntn_...`または`secret_...`から始まるトークン)をコピーする
3. Notionで対象のデータベース「note記事DB(会社の裏設定)」を開き、右上の「…」→「コネクト」から2.で作成したインテグレーションを追加する(これをしないとAPIから読み取れない)
4. リポジトリの Settings → Secrets and variables → Actions で、2.のトークンを `NOTION_API_KEY` という名前のシークレットとして登録する
5. データベースが変わった場合は `.github/workflows/sync-notion-articles.yml` の `NOTION_DATABASE_ID` を書き換える(データベースURLの32桁のIDをUUID形式`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`に直したもの)

設定が終わったら、Actionsタブから`Sync Note Articles from Notion`を手動実行(workflow_dispatch)して、`note-trend-generator/state/published-articles.json`が更新されるか確認してください。Notion APIの呼び出し自体は無料です(データ量に応じた従量課金はありません)。

### Google Driveとの連携(sync-drive-articles.js)— 過去記事の参照用・現在は停止中

過去記事はGoogle Driveのフォルダ(`会社の裏設定　claude`)にもMarkdownファイルとして残っていますが、新規記事の追記先はNotionに一本化したため、`sync-drive-articles.js`とそのワークフロー(`.github/workflows/sync-note-drive.yml`)は現在停止中(workflow_dispatchのみ)です。仕組み自体はまだ動作するので、Drive側に旧形式で記事を追加する運用に戻す場合は再開できます。

処理の流れ(参考):

1. Googleサービスアカウントの認証情報(`GOOGLE_SERVICE_ACCOUNT_JSON`)でOAuth2アクセストークンを取得する(`lib/googleServiceAuth.js`。外部ライブラリを使わず、Node標準の`crypto`でJWT署名を自前生成している)
2. Drive API v3で対象フォルダのファイル一覧を取得する(`lib/driveApi.js`)
3. タイトルに「見出し画像プロンプト」を含むファイルを除外し、`state/published-articles.json`にまだ無いファイル(=新規記事)を見つける
4. ファイル名(`NNN_タイトル.md`)から番号・タイトルを取り出す。その形式に合わないファイルだけ本文を取得し、先頭行の見出しから取り出す
5. 新規エントリを`state/published-articles.json`に追記し、番号順にソートする
6. (ワークフロー側で)変更をコミット・push する

### 既知のデータの不整合

Notionへ移行した24記事(#193〜#215)のうち、番号にまつわる不整合が2件見つかっています。

- ファイル名が`192`の記事は、本文の見出しでは自ら「#193」を名乗っていました。内容を優先し、#193として登録しています(「#192」に相当する記事は存在しません)。
- ファイル名が`193.md`(番号なし)の記事は、中身を見ると実際は「#195」を名乗る別内容の記事でした(既存の`195_...`ファイルとは別物)。番号が重複しているため、Notion上ではタイトルに`#195b(要確認:番号重複)`と付記し、ステータスを「要確認」にして登録しています(`番号`プロパティ自体はどちらも195のままです)。どちらが正しい#195かは、Drive側の確認をおすすめします。

## ファイル構成

- `generate-trend-report.js` — キーワードごとの検索→トレンド分析・ネタ提案の生成→Discord通知→履歴保存までを繋ぐメイン処理
- `lib/searchNote.js` — note.comの検索結果ページをヘッドレスブラウザ(Puppeteer)で開き、記事タイトル・URLを取得する。note.comは検索結果をクライアントサイドで描画するため、単純なfetchでは中身が取得できず、Puppeteerで実際にページを開いてDOMから読み取っている
- `lib/generateTrendReport.js` — 収集したタイトル一覧・公開済み記事一覧からトレンド分析・次のネタ提案をClaude APIで生成する
- `keywords.json` — 検索キーワードの設定ファイル
- `state/history.json` — 過去に提案したネタのタイトル履歴(直近200件。重複提案を避けるための参考データとして次回生成時に渡す)
- `state/published-articles.json` — 実際に書き上げたnote記事の一覧(番号・タイトル・ステータス・NotionページID等)。`sync-notion-articles.js`がNotionの内容で丸ごと同期する
- `state/notion-migration.json` — Google DriveからNotionへの過去記事移行記録(移行日・NotionのDB/データソースID・記事ごとの対応表・既知の番号不整合)
- `state/trend-report-*.json` — 実行ごとの生成ログ(収集結果・レポート全文)
- `sync-notion-articles.js` — Notionのnote記事DBを確認し、`state/published-articles.json`をNotionの内容で同期するスクリプト(GitHub Actionsで定期実行。現在の運用)
- `lib/notionApi.js` — Notion API(Internal Integrationトークン)のデータベース取得の薄いラッパー
- `sync-drive-articles.js` — Google Driveのnote記事フォルダを確認し、新規記事を`state/published-articles.json`へ取り込むスクリプト(過去記事の参照用の仕組みとして残置。現在は停止中)
- `lib/googleServiceAuth.js` — Googleサービスアカウントの認証情報からOAuth2アクセストークンを取得する(JWT署名を`crypto`で自前生成)
- `lib/driveApi.js` — Drive API v3のファイル一覧取得・本文取得の薄いラッパー

## 注意点・既知の制約

- **note.comのDOM構造や、ボット対策(bot detection)の変更に弱い設計です。** 検索結果ページはクライアントサイドレンダリングのため、note.com側の実装変更で取得できなくなる可能性があります。すべてのキーワードで0件だった場合は、正常に分析せずDiscordに警告のみ送って処理を打ち切ります(誤ったトレンド分析を作らないための安全策)。**初回はworkflow_dispatchで手動実行し、Discordに正しくレポートが届くか確認してください。**
- note.comへのアクセスがデータセンターIPからのアクセスとして制限される可能性があります(GitHub ActionsのIPが対象になった場合、検索結果が継続的に0件になることがあります)。その場合は`lib/searchNote.js`の待機時間・セレクタの調整や、別の情報源への切り替えが必要です。
- Threads側の競合投稿は、SNS公式APIが任意の他人の投稿を機械的に収集する用途を想定していないため、このツールでは対象にしていません(comment-generator/README.md参照)。競合Threadsアカウントを見たい場合は、投稿URLを`comment-generator`の仕組み(OGPベストエフォート取得)で個別に確認する運用にしてください。
- Claude APIの呼び出しのみ費用がかかります(テキスト生成のみなので少額)。それ以外(検索・ブラウザ操作)は無料です。

## 今後の拡張案

- `threads-post-generator/generate-posts.js` にはすでに、自分の過去投稿の反応データ(`performance.json`)をプロンプトに反映する仕組み(フェーズ3、未使用)が用意されています。ここにトレンド分析の要約も合わせて渡すようにすると、Threads投稿のテーマ選定にもトレンドが反映されるようになります
- 今は「ネタ提案」止まりですが、選んだネタをそのままnote記事の下書き(見出し構成+各見出しの要点)まで自動生成する「note記事ドラフト生成」機能に発展させることもできます
