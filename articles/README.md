# articles/

書き終えたnote記事の本文を、このフォルダに `.md` ファイルとして置いてください。

例: `articles/2026-09-04-hoge.md`

```
（note記事の本文をそのまま貼り付ける)
```

このフォルダに新しい `.md` ファイルをpushすると、GitHub Actionsが自動的に動いて
その記事から「フックの効いたThreads投稿文」と「フックの効いたX投稿文」を1本ずつ生成し、
Discordにコピーしやすい形(コードブロック)で通知します。

- note・Threads・Xへの実際の投稿はすべて手動です。このワークフローは下書きを作るだけです。
- ファイル名(拡張子を除いた部分)がそのまま通知内のタイトル表示に使われます。
- Discordが届かない/もう一度作り直したい場合は、GitHub Actionsの
  `Note SNS Draft Generator` を `article_path` にファイルパスを指定して手動実行できます。
