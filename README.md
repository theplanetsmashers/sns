# SNS運用自動化ツール

Threads運用を楽にするための小さなツール群です。

- [`threads-post-generator/`](threads-post-generator/) — 毎日の投稿案をClaude APIで自動生成し、Discordに通知するツール(フェーズ1)。GitHub Actionsで毎日自動実行。
- [`comment-generator/`](comment-generator/) — 他の人の投稿に対する返信コメント案をClaude APIで自動生成するツール(フェーズ2)。GitHub Issueを作るだけでDiscordに案が届く、スマホだけで完結する運用と、PCでローカルWebアプリとして使う運用の2通りに対応。
- [`edu-material-generator/`](edu-material-generator/) — テーマ名から講義用のPPTX・スライド画像・ナレーション音声・動画(mp4)までを自動生成するツール。GitHub Issueにテーマを1件書くだけで、教材制作一式が数分で完成する。

どちらのツールも、実際の投稿・送信は人間が最終判断して手動で行う設計です(全自動投稿は行いません)。
