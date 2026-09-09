# note紹介動画自動生成ツール(note-teaser-generator)

note記事のタイトルと本文を渡すだけで、その記事へ読者を誘導するための**YouTube用・約30秒の紹介動画**を自動生成します。「YouTubeをnoteへの入り口として使いたい」というニーズに合わせ、記事の核心(オチ)は明かさず、続きが気になる状態でnoteへ誘導する台本になるように作られています。

**スマホだけで完結**する運用と、**基本無料**(ナレーション音声も含めてAPI課金なしで生成)を優先した設計です(edu-material-generatorと同じ方針)。

生成されるもの:

- `script.json` / `script.txt` — シーンごとの表示テキスト・ナレーション原稿・YouTube概要欄案
- `images/scene-XX.png` — 各シーンを描画した画像(既定: 縦1080x1920 = YouTube Shorts想定)
- `audio/narration-XX.wav` — 各シーンのナレーション音声
- `teaser.mp4` — シーン画像+ナレーションを結合した紹介動画(約30秒)

## 本文の入力方法(2通り)

note記事はGoogle Driveの非公開ドキュメントで管理していることが多いため、次の2通りに対応しています。

1. **Googleドキュメントの共有リンク**を渡す方法。ドキュメントの共有設定を「リンクを知っている全員が閲覧可(閲覧者)」に変更すれば、認証なしで本文を取得できます(GoogleドキュメントのURLを渡すだけ)。
2. **記事本文を直接貼り付ける**方法。共有リンクが使えない・非公開のままにしたい場合は、Issueの「記事本文」欄に記事の冒頭部分などをそのまま貼り付けてください。

両方入力した場合、または共有リンクからの取得に失敗した場合は、貼り付けた本文を優先/フォールバックとして使います。

## スマホだけで完結する使い方

1. GitHubアプリ(またはスマホのブラウザ)のIssueタブから「note紹介動画生成リクエスト」テンプレートを開き、記事タイトルと本文(またはGoogleドキュメントの共有リンク)を入力して起票する
2. 数分待つ(裏でActionsが台本→音声→動画までを自動生成)
3. **完成すると、Discordに動画(mp4)ファイルがそのまま添付されて届く**(Discordアプリでそのまま再生・保存できる)
4. ファイルが大きすぎてDiscordに添付できなかった場合だけ、通知内のリンクからActionsのArtifactsを開く(この場合はPCの方がスムーズ)

PC・GitHub Actionsの画面を開く必要は基本的にありません。動画が完成したら、実際のYouTubeへの投稿(タイトル・概要欄への記入含む)は人間が最終判断して手動で行う設計です(全自動投稿は行いません)。

## 無料で生成する仕組み

| 処理 | 使うもの | 費用 |
|---|---|---|
| 台本(シーン構成・ナレーション原稿)の生成 | Claude API | 従量課金(テキストのみなので1回あたり数円程度) |
| ナレーション音声 | **VOICEVOX**(GitHub Actions上でDockerコンテナとして自動起動。APIキー不要) | 無料 |
| シーン画像・動画の生成 | Puppeteer / ffmpeg(すべてワークフロー内で実行、ffmpegはワークフロー内でapt installする) | 無料 |

事前に用意が必要なのは実質 `ANTHROPIC_API_KEY` だけです。`OPENAI_API_KEY` を設定した場合はより自然な音声(有料)に切り替わりますが、必須ではありません。

VOICEVOXは無料の音声合成エンジンですが、キャラクターごとに利用規約でクレジット表記が求められています。公に配布する場合は [VOICEVOXの利用規約](https://voicevox.hiroshiba.jp/term/) を確認してください。

## セットアップ手順

1. リポジトリの Settings → Secrets and variables → Actions で以下を登録(edu-material-generatorと共通のシークレットが使えます)
   - `ANTHROPIC_API_KEY`: Claude APIキー(必須。台本生成に使用)
   - `DISCORD_WEBHOOK_URL`: 完成した動画を受け取るDiscordチャンネルのWebhook URL(スマホだけで完結させるなら実質必須)
   - `OPENAI_API_KEY`: OpenAIのAPIキー(任意。設定するとOpenAI TTSに切り替わる。通常は不要)
2. Issueタブから「note紹介動画生成リクエスト」テンプレートで新しいIssueを作成する
   - テンプレートのタイトル(`[note動画生成] `)でワークフローが判定・起動する(ラベルには依存していない)
   - 完成するとIssueへのコメントと、Discordへ(動画を添付して)通知される

## ローカルでの実行

```bash
cd note-teaser-generator
npm install
export ANTHROPIC_API_KEY=sk-ant-...
# VOICEVOXを使う場合は事前に起動しておく(例: Docker)
# docker run -d -p 50021:50021 voicevox/voicevox_engine:cpu-ubuntu20.04-latest
npm run generate -- "記事タイトル" "記事本文をここに" "https://note.com/xxxxx/n/xxxxxxxxxxxx"
```

`output/<日時>_<動画タイトル>/` 配下に生成物一式が出力されます。動画生成には `ffmpeg` がPATH上に必要です(`apt install ffmpeg` 等で事前にインストールしてください。GitHub Actions上のワークフローではインストール手順込みで用意済みです)。ローカルでVOICEVOXを起動していない場合、TTSは失敗して無音音声にフォールバックします(`OPENAI_API_KEY`を設定していればそちらにフォールバック)。

## ファイル構成

- `generate-teaser.js` — 記事タイトル・本文→台本→音声→画像→動画までを繋ぐメイン処理
- `lib/fetchDriveDoc.js` — Googleドキュメントの共有リンク(リンクを知っている全員が閲覧可)から本文を取得。非公開ドキュメントの場合はnullを返し、本文欄への貼り付けにフォールバックする
- `lib/generateScript.js` — Claude APIで台本(動画タイトル・シーンごとの表示テキスト/ナレーション・YouTube概要欄案)を生成。オチを明かさずnoteへ誘導する構成になるようプロンプトで制約している
- `lib/renderTeaserImages.js` — 各シーンをHTML/CSSで描画し、Puppeteerでスクリーンショット(既定: 縦1080x1920、最終シーンはCTA専用デザイン)
- `lib/synthesizeAudio.js` — VOICEVOX(無料)を優先してナレーション音声を生成。失敗時はOpenAI TTS→無音の順にフォールバック
- `lib/buildVideo.js` — ffmpegでシーン画像+音声をクロスフェードしながら結合し、紹介動画(mp4)を組み立てる
- `bot.js` — GitHub Issueをトリガーに上記一式を実行し、Issueコメント+Discordへのファイル添付通知まで行うエントリーポイント
- `state/history.json` — 生成履歴の記録

## 注意点

- Claude APIの呼び出しだけは費用がかかります(テキスト生成のみなので少額)。それ以外は無料で完結する設計です
- Discordへのファイル添付は既定で8MB以下のファイルのみ(`DISCORD_MAX_FILE_MB`で変更可)。30秒程度の動画であれば通常は収まりますが、超えた場合はArtifacts経由の受け取りにフォールバックします
- VOICEVOXのDockerコンテナ起動には数十秒〜1分ほどかかることがあります(ワークフロー内で起動待ちをしています)
- 動画のクオリティはシーン画像(テキスト主体)+ナレーションの組み合わせです(アニメーションやアバターはありません)。まずは工数削減を優先したv1という位置づけです
- Googleドキュメントの共有リンクは「リンクを知っている全員が閲覧可」に設定した場合のみ本文を自動取得できます。社外秘の内容を含む記事は、共有設定を変更せず本文欄への直接貼り付けを使ってください
