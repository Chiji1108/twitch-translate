# Miri Translator by ミリちゃんねる

日本語のライブ配信向けの、音声認識＋多言語翻訳字幕アプリです。ゲーム、雑談、VTuberなど、TwitchやYouTubeのさまざまな配信で利用できます。一文の音声をOpenAIの `gpt-transcribe` で高精度に文字起こしし、その日本語から通常処理の `gpt-5.6-terra` が最大3言語の翻訳とふりがなを独立した並列リクエストで生成します。

マイク使用中は `gpt-live-transcribe` を常時接続し、完成字幕が一切ないときだけTTFT短縮用の仮日本語をストリーミング表示します。

## セットアップ

```bash
bun install
bun dev
```

[http://localhost:3000](http://localhost:3000) を開き、画面最上部の入力欄に自分のOpenAI API Keyを入力してから「マイクを開始」を押してください。ブラウザがマイク利用の許可を求めた場合は許可します。

APIキーは通常、タブのメモリ上だけに保持し、ページを更新すると消去されます。「このブラウザにAPIキーを保存」を有効にした場合だけ、そのブラウザの `localStorage` に保存して次回アクセス時に自動入力します。チェックを外すと保存済みキーを削除します。共有端末では保存機能を使用しないでください。

キーは暗号化通信でMiri Translatorのサーバーを経由し、OpenAI APIへのリクエストにのみ使用します。Cookie、データベース、字幕同期データ、URLには保存せず、API料金は入力したキーのOpenAIアカウントに請求されます。

## OBSで使う

1. アプリを開いたまま字幕を開始します。
2. OBSで「ブラウザ」ソースを追加します。
3. URLに `http://localhost:3000/overlay` を設定します。
4. 幅 `800`、高さ `400` を目安に設定します。字幕が切れる場合は高さや幅を広げてください。

メイン画面で日本語・翻訳それぞれの文字サイズと文字色、中央／左寄せ、背景、表示時間を設定できます。オーバーレイとは `BroadcastChannel` と `localStorage` で同期するため、同じPC上で利用してください。

## 字幕フロー

1. マイク開始時に `gpt-live-transcribe` のRealtime文字起こしセッションへ接続します。
2. マイク音声を常時ストリーミングし、完成字幕が一切ないときだけ仮日本語を表示します。
3. AudioWorkletが設定した無音時間で一文を区切り、WAV音声を `/api/captions` へ送ります。
4. `gpt-transcribe` が任意の配信コンテキストを参考に、日本語字幕を生成します。
5. 通常処理の `gpt-5.6-terra` が、選択した最大3言語を1言語1リクエストで並列翻訳します。各翻訳は通常テキストのdelta単位で表示へ反映します。
6. 翻訳と同時に、別のTerraリクエストがふりがなの読みを生成します。
7. サーバーが原文とふりがなの対応を検証し、完成したふりがなを表示へ反映します。

音声ターンは順番に処理します。次の字幕パッケージが完成するまで、現在の字幕は消去・途中更新されません。ただし「自動で字幕を消す」が有効で、処理待ちもない場合は設定時間後にフェードアウトします。

一瞬の物音はブラウザ側で除外します。また、送信した音声に文字として認識できる発話がなく `gpt-transcribe` が空文字を返した場合は正常な無音ターンとしてスキップし、エラーを表示せず現在の字幕を維持します。

## モデル構成

- `gpt-transcribe`: 一文の高精度な日本語文字起こし
- `gpt-5.6-terra`（通常処理）: 日本語字幕から各言語の翻訳とふりがなの読みを独立したリクエストで並列生成
- `gpt-live-transcribe`: マイク使用中に常時接続し、空画面だけに表示する仮日本語を生成
- AudioWorklet VAD: 描画ループに依存せず、ローカルのマイク音量から一文を区切る
- Next.js Route Handler: 利用者が入力したOpenAI APIキーを保存せず、OpenAI APIへのリクエストだけに使用

`gpt-live-transcribe` の出力はTTFT短縮用の表示レイヤーに限定され、`gpt-transcribe`、翻訳、ふりがな、履歴には渡しません。Realtime接続に失敗しても字幕生成パイプラインは継続します。`gpt-realtime-translate` と `gpt-realtime-2.1-mini` は使用しません。API料金は、マイク使用中のLive文字起こし音声、字幕用に送った発話音声、Terraの入出力トークンに応じて発生します。

マイク開始から停止まで、各APIレスポンスの使用量とLive文字起こしの接続時間を基に、今回の推定料金とモデル別の内訳を画面に表示します。中断されたリクエストや請求時の丸めによって実際の請求額と差が生じる可能性があるため、表示額は概算です。

## 配信コンテキスト

「配信コンテキスト」には、配信のテーマ、扱う作品、登場人物、固有名詞など、その配信に関係する情報を任意で入力できます。入力内容は仮日本語、高精度な日本語字幕、翻訳のすべてで背景情報として利用します。空欄でも字幕を生成できます。

## ふりがな

アプリが日本語字幕から連続漢字列と位置を抽出します。翻訳とは独立したTerraのStructured Outputs応答が、話し言葉や配信コンテキストに沿った語境界と読みを返します。

サーバー側で各語を連結して元の漢字列と完全一致することを検証し、原文そのものは決定論的に組み立てます。検証に失敗した場合は古い完成字幕を維持し、画面へ詳細なエラー情報を表示します。

## コマンド

```bash
bun run lint
bunx tsc --noEmit
bun test
bun run build
```

## 参考

- [OpenAI GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe)
- [OpenAI GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI GPT-Live-Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe)
- [OpenAI Realtime Transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [音声認識字幕ちゃん](https://sayonari.github.io/jimakuChan/v2/)
