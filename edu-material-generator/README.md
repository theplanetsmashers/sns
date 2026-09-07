# 教材自動生成ツール(edu-material-generator)

テーマ名を1つ入れるだけで、講義用の教材一式をClaude APIで自動生成します。講師側の「構成を考える」「PPTXを作る」「動画を作る」という工数のかかる作業を丸ごと自動化し、受講者がそれを見るだけで学べる形に仕上げることが目的です。

生成されるもの:

- `outline.json` — 講義タイトル・学習目標・スライドごとの内容(構成データ)
- `script.txt` — 全スライドのナレーション原稿(講師用の読み上げ台本としてもそのまま使える)
- `course.pptx` — 実際のPowerPointファイル(スピーカーノートにナレーション原稿入り。手直しして使える)
- `images/slide-XX.png` — 各スライドを描画した画像
- `audio/narration-XX.mp3` — 各スライドのナレーション音声
- `course.mp4` — スライド+ナレーションを結合した講義動画

## セットアップ手順

1. リポジトリの Settings → Secrets and variables → Actions で以下を登録
   - `ANTHROPIC_API_KEY`: Claude APIキー(必須。講義構成の生成に使用)
   - `OPENAI_API_KEY`: OpenAIのAPIキー(任意。設定するとTTSで実際にナレーションを読み上げた動画になる。未設定の場合は無音動画になる — 尺は原稿の文字数から自動計算されるので動画自体は問題なく生成できる)
   - `DISCORD_WEBHOOK_URL`: 完成通知を受け取るDiscordチャンネルのWebhook URL(任意)
2. Issueタブから「教材自動生成リクエスト」テンプレートで新しいIssueを作成し、テーマを入力する
   - `edu-material-request` ラベルが自動で付き、ワークフローが起動する
   - 数分後、Issueへのコメントと(設定していれば)Discordに完成通知が届く
   - PPTX・スライド画像・音声・動画は、そのワークフロー実行の Artifacts に添付される(Actionsタブ → 該当の実行 → Artifacts)

## ローカルでの実行

```bash
cd edu-material-generator
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...   # 任意。ナレーション付き動画にしたい場合
npm run generate -- "初心者向けExcel関数入門"
```

`output/<日時>_<テーマ>/` 配下に生成物一式が出力されます。動画生成には `ffmpeg` がPATH上に必要です(GitHub Actionsのubuntu-latestには標準で入っています)。

## ファイル構成

- `generate-course.js` — テーマ→構成→PPTX→画像→音声→動画までを繋ぐメイン処理
- `lib/generateOutline.js` — Claude APIで講義構成(タイトル・学習目標・スライド内容・ナレーション原稿)を生成
- `lib/buildDeck.js` — 構成データをタイトル/本編/まとめの「スライド配列」に平坦化する共通処理
- `lib/buildPptx.js` — pptxgenjsで実際の.pptxファイルを生成
- `lib/renderSlideImages.js` — 各スライドをHTML/CSSで描画し、Puppeteerでスクリーンショット
- `lib/synthesizeAudio.js` — OpenAI TTSでナレーション音声を生成(APIキーが無い場合は無音音声で代替)
- `lib/buildVideo.js` — ffmpegでスライド画像+音声を結合し、講義動画(mp4)を組み立てる
- `bot.js` — GitHub Issueをトリガーに上記一式を実行するエントリーポイント
- `state/history.json` — 生成履歴の記録

## 今後の拡張ポイント

- スライドデザインのテーマ(配色・フォント)を選べるようにする
- 章立て(複数動画に分割したコース全体)への対応
- 生成した教材に対するフィードバック(受講者の理解度・反応)を集めて構成の改善にフィードバックする仕組み
- ローカルWebアプリ版(comment-generatorと同様の構成)でブラウザから直接テーマ入力・プレビューできるようにする

## 注意点

- 1回の生成でClaude APIとOpenAI TTS APIをそれぞれ呼び出すため、API利用料がかかります。スライド枚数が多いほど呼び出し・処理時間・コストが増えます
- 動画のクオリティはシンプルなスライド+ナレーションの組み合わせです(アニメーションやアバターはありません)。まずは工数削減を優先したv1という位置づけです
