# 教材自動生成ツール(edu-material-generator)

テーマ名を1つ入れるだけで、講義用の教材一式を自動生成します。講師側の「構成を考える」「PPTXを作る」「動画を作る」という工数のかかる作業を丸ごと自動化し、受講者がそれを見るだけで学べる形に仕上げることが目的です。

**スマホだけで完結**する運用と、**基本無料**(ナレーション音声も含めてAPI課金なしで生成)を優先した設計になっています。

生成されるもの:

- `outline.json` — 講義タイトル・学習目標・スライドごとの内容(構成データ)
- `script.txt` — 全スライドのナレーション原稿(講師用の読み上げ台本としてもそのまま使える)
- `course.pptx` — 実際のPowerPointファイル(スピーカーノートにナレーション原稿入り。手直しして使える)
- `images/slide-XX.png` — 各スライドを描画した画像(720p)
- `audio/narration-XX.wav` — 各スライドのナレーション音声
- `course.mp4` — スライド+ナレーションを結合した講義動画

## スマホだけで完結する使い方

1. GitHubアプリ(またはスマホのブラウザ)のIssueタブから「教材自動生成リクエスト」テンプレートを開き、テーマを入力して起票する
2. 数分待つ(裏でActionsが講義構成→音声→動画までを自動生成)
3. **完成すると、DiscordにPPTXと動画(mp4)ファイルがそのまま添付されて届く**(Discordアプリでそのまま再生・保存できる)
4. ファイルが大きすぎてDiscordに添付できなかった場合だけ、通知内のリンクからActionsのArtifactsを開く(この場合はPCの方がスムーズ)

PC・GitHub Actionsの画面を開く必要は基本的にありません。

## 無料で生成する仕組み

| 処理 | 使うもの | 費用 |
|---|---|---|
| 講義構成・ナレーション原稿の生成 | Claude API | 従量課金(テキストのみなので1回あたり数円程度) |
| ナレーション音声 | **VOICEVOX**(GitHub Actions上でDockerコンテナとして自動起動。APIキー不要) | 無料 |
| スライド画像・PPTX・動画の生成 | Puppeteer / pptxgenjs / ffmpeg(すべてワークフロー内で実行、ffmpegはワークフロー内でapt installする) | 無料 |
| GitHub Actionsの実行時間 | — | Freeプランの無料枠内で収まる想定 |

つまり事前に用意が必要なのは実質 `ANTHROPIC_API_KEY` だけで、それ以外の追加登録(TTSサービスの契約など)は不要です。`OPENAI_API_KEY` を設定した場合はより自然な音声(有料)に切り替わりますが、必須ではありません。

VOICEVOXは無料の音声合成エンジンですが、キャラクターごとに利用規約でクレジット表記が求められています。生成した動画には自動で画面下に「音声: VOICEVOX」のクレジットを入れていますが、社外・学外など公に配布する場合は [VOICEVOXの利用規約](https://voicevox.hiroshiba.jp/term/) も確認してください。

## セットアップ手順

1. リポジトリの Settings → Secrets and variables → Actions で以下を登録
   - `ANTHROPIC_API_KEY`: Claude APIキー(必須。講義構成の生成に使用)
   - `DISCORD_WEBHOOK_URL`: 完成したPPTX・動画を受け取るDiscordチャンネルのWebhook URL(スマホだけで完結させるなら実質必須)
   - `OPENAI_API_KEY`: OpenAIのAPIキー(任意。設定するとOpenAI TTSに切り替わる。通常は不要)
2. Issueタブから「教材自動生成リクエスト」テンプレートで新しいIssueを作成し、テーマを入力する
   - テンプレートのタイトル(`[教材生成] `)でワークフローが判定・起動する(ラベルには依存していない)
   - 完成するとIssueへのコメントと、Discordへ(PPTX・動画を添付して)通知される

## ローカルでの実行

```bash
cd edu-material-generator
npm install
export ANTHROPIC_API_KEY=sk-ant-...
# VOICEVOXを使う場合は事前に起動しておく(例: Docker)
# docker run -d -p 50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest
npm run generate -- "初心者向けExcel関数入門"
```

`output/<日時>_<テーマ>/` 配下に生成物一式が出力されます。動画生成には `ffmpeg` がPATH上に必要です(`apt install ffmpeg` 等で事前にインストールしてください。GitHub Actions上のワークフローではインストール手順込みで用意済みです)。ローカルでVOICEVOXを起動していない場合、TTSは失敗して無音音声にフォールバックします(`OPENAI_API_KEY`を設定していればそちらにフォールバック)。

## ファイル構成

- `generate-course.js` — テーマ→構成→音声→画像→動画までを繋ぐメイン処理
- `lib/generateOutline.js` — Claude APIで講義構成(タイトル・学習目標・スライド内容・ナレーション原稿)を生成
- `lib/buildDeck.js` — 構成データをタイトル/本編/まとめの「スライド配列」に平坦化する共通処理
- `lib/buildPptx.js` — pptxgenjsで実際の.pptxファイルを生成
- `lib/synthesizeAudio.js` — VOICEVOX(無料)を優先してナレーション音声を生成。失敗時はOpenAI TTS→無音の順にフォールバック
- `lib/renderSlideImages.js` — 各スライドをHTML/CSSで描画し、Puppeteerでスクリーンショット(720p)
- `lib/buildVideo.js` — ffmpegでスライド画像+音声を結合し、講義動画(mp4)を組み立てる
- `bot.js` — GitHub Issueをトリガーに上記一式を実行し、Issueコメント+Discordへのファイル添付通知まで行うエントリーポイント
- `state/history.json` — 生成履歴の記録

## 今後の拡張ポイント

- スライドデザインのテーマ(配色・フォント)を選べるようにする
- 章立て(複数動画に分割したコース全体)への対応
- 生成した教材に対するフィードバック(受講者の理解度・反応)を集めて構成の改善にフィードバックする仕組み
- ローカルWebアプリ版(comment-generatorと同様の構成)でブラウザから直接テーマ入力・プレビューできるようにする

## 注意点

- Claude APIの呼び出しだけは費用がかかります(テキスト生成のみなので少額)。それ以外は無料で完結する設計です
- Discordへのファイル添付は既定で8MB以下のファイルのみ(`DISCORD_MAX_FILE_MB`で変更可)。スライド枚数が多い・ナレーションが長いと動画がこれを超え、Artifacts経由の受け取りにフォールバックします
- VOICEVOXのDockerコンテナ起動には数十秒〜1分ほどかかることがあります(ワークフロー内で起動待ちをしています)
- 動画のクオリティはシンプルなスライド+ナレーションの組み合わせです(アニメーションやアバターはありません)。まずは工数削減を優先したv1という位置づけです
- VOICEVOXコンテナの起動やAPI仕様は将来変更される可能性があります。うまく起動しない場合はワークフローのログを確認してください
