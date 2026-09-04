# 仕事のお悩み相談アプリ（会社の裏設定アドバイザー）

Google Drive に保存されている「会社の裏設定」記事シリーズ（製造業の管理職としての実体験エッセイ）
の中身を実際に参照しながら、仕事の困りごと・悩みに対してアドバイスを返すWebアプリです。

## 仕組み

1. `../data/articles.json` に、Google Drive上の記事本文をあらかじめ抽出したデータセットを持つ。
2. ユーザーが悩みを入力すると、サーバー側で記事データセットとの類似度を計算し、関連度の高い記事を
   数件（デフォルト4件）抽出する（`lib/retrieval.js`）。日本語は分かち書きが無いため、2文字の
   バイグラム（文字n-gram）の重なり具合で類似度を測る簡易的な方式を採用しており、外部ライブラリ
   や事前学習済みモデルは不要。
3. 抽出した記事の本文を Claude API（Anthropic Messages API）へ渡し、それらの記事の具体的な内容に
   言及しながらアドバイス文を生成する（`lib/advice.js`）。
4. `ANTHROPIC_API_KEY` が未設定の場合は、AI生成はスキップし、関連記事の一覧だけを表示する
   フォールバックモードで動作する（記事は表示されるので、そのまま読んで参考にできる）。

## セットアップ

```bash
cd advice-app
cp .env.example .env
# .env を開いて ANTHROPIC_API_KEY を設定する（省略可。設定しない場合は関連記事表示のみ）
node server.js
```

ブラウザで `http://localhost:3000` を開く。

Node.js 18以上が必要（`fetch` を標準で使用）。npm パッケージへの依存はなし。

### Anthropic APIキーの取得

https://console.anthropic.com/ でアカウントを作成し、APIキーを発行してください。
費用が発生するので、利用量には注意してください。

## 記事データセット（`../data/articles.json`）について

このデータは、Google Drive 内の以下2フォルダにある記事を Claude Code セッション内で
Google Drive 連携ツールを使って抽出し、JSONファイルとして書き出したものです。

- 「会社の裏設定　note」フォルダ
- 「会社の裏設定　claude」フォルダ

アプリ自体はこのJSONファイルをローカルデータとして読み込むだけで、実行時にGoogle Driveへ
アクセスすることはありません（Driveへの自動アクセスにはOAuth認証の実装が別途必要なため、
今回は「セッション内で一度エクスポートしたスナップショットを参照する」方式にしています）。

### データを更新したいとき

Google Drive に新しい記事を追加した場合、`data/articles.json` は自動更新されません。
Claude Code（このリポジトリのセッション）に「Google Driveの記事データを最新化して」と
依頼すれば、Drive連携ツールで最新記事を再取得し、`data/articles.json` を再生成できます。

### note.comへの公開リンクの同期

`data/articles.json` の各記事は、Google Driveの下書きがnote.com（kotolog_note）で
実際に公開されると、`url` フィールドがそのnote.com記事のURLに差し替わる。

```bash
cd advice-app
npm run sync-note
```

タイトルはnote.com公開時に書き換えられることが多いため、本文テキストの重なり具合で
記事を照合している（タイトルの文字列一致では判定しない）。まだGoogle Drive側にしか
存在しない記事（未公開の予定稿、または意図的にnote化しない記事）は、対応するnote.com
記事が見つからない限りDriveのリンクのまま変わらない。

このリポジトリでは、noteへの新規投稿に合わせて定期的にこのスクリプトを実行し、
`data/articles.json` の更新と、公開中のArtifact（相談アプリのUI）への反映を
Claude Codeの定期実行タスクで自動化している。

`data/articles.json` の構造:

```json
{
  "generatedAt": "2026-...",
  "source": "Google Drive - 会社の裏設定シリーズ",
  "articles": [
    {
      "id": "Google Drive file id",
      "title": "記事タイトル",
      "articleNumber": 198,
      "folder": "note",
      "url": "https://drive.google.com/...",
      "body": "記事本文",
      "createdTime": "...",
      "modifiedTime": "..."
    }
  ]
}
```

## API

### `GET /api/status`

記事件数、データ生成日時、AIアドバイス生成が有効かどうかを返す。

### `POST /api/advice`

リクエストボディ: `{ "concern": "仕事の悩みの内容" }`

レスポンス例（AI生成あり）:

```json
{
  "mode": "llm",
  "advice": "アドバイス文...",
  "references": [
    { "title": "記事タイトル", "articleNumber": 198, "url": "...", "score": 0.42 }
  ]
}
```

`ANTHROPIC_API_KEY` 未設定時は `mode: "fallback"` となり、`advice` は `null`、
`references` に関連記事一覧のみが入る。関連記事が見つからない場合は `mode: "no_match"`。

## 制限事項

- 類似度検索はバイグラムベースの簡易手法であり、意味的な検索（embeddingベース等）ではない。
  記事数が増えたり、精度に不満が出てきた場合は、埋め込みベクトル検索への切り替えを検討する。
- Google Driveへのリアルタイムアクセスは行わない（上記「データを更新したいとき」を参照）。
