# SNS運用自動化ツール

Threads運用を楽にするための小さなツール群です。

- [`threads-post-generator/`](threads-post-generator/) — 毎日の投稿案をClaude APIで自動生成し、Discordに通知するツール(フェーズ1)。GitHub Actionsで毎日自動実行。
- [`comment-generator/`](comment-generator/) — 他の人の投稿に対する返信コメント案をClaude APIで自動生成するツール(フェーズ2)。GitHub Issueを作るだけでDiscordに案が届く、スマホだけで完結する運用と、PCでローカルWebアプリとして使う運用の2通りに対応。
- [`edu-material-generator/`](edu-material-generator/) — テーマ名から講義用のPPTX・スライド画像・ナレーション音声・動画(mp4)までを自動生成するツール。GitHub Issueにテーマを1件書くだけで、教材制作一式が数分で完成する。
- [`note-teaser-generator/`](note-teaser-generator/) — note記事のタイトル・本文から、YouTube用の約30秒の紹介動画(台本・ナレーション・動画mp4)を自動生成するツール。noteへの入り口としてYouTubeを使うための、オチを明かさない誘導台本になるよう設計されている。
- [`note-trend-generator/`](note-trend-generator/) — note.comの検索結果から競合・トレンドを分析し、次に書くべきnote記事のネタ案(タイトル・フック・構成)を自動生成してDiscordに届けるツール。GitHub Actionsで週次自動実行され、「トレンド調査→分析→ネタ提案」のサイクルを回す。

どちらのツールも、実際の投稿・送信は人間が最終判断して手動で行う設計です(全自動投稿は行いません)。
