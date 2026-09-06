# SNS運用自動化ツール

Threads運用を楽にするための小さなツール群です。

- [`threads-post-generator/`](threads-post-generator/) — 毎日の投稿案をClaude APIで自動生成し、Discordに通知するツール(フェーズ1)。GitHub Actionsで毎日自動実行。
- [`comment-generator/`](comment-generator/) — 他の人の投稿に対する返信コメント案をClaude APIで自動生成するツール(フェーズ2)。GitHub Issueを作るだけでDiscordに案が届く、スマホだけで完結する運用と、PCでローカルWebアプリとして使う運用の2通りに対応。
- [`manager-1on1-tool/`](manager-1on1-tool/) — 新任管理職向け1on1支援ツール(フェーズ3)。部下プロフィールを登録すると、Claude APIが1on1前のアジェンダ提案・1on1後の要点抽出・複数回の記録からの傾向分析を支援するローカルWebアプリ。

投稿・送信系のツールは、実際の投稿・送信を人間が最終判断して手動で行う設計です(全自動投稿は行いません)。
