# 実装方針

## 現在の実装方針

現在は Bun + Vite + TypeScript を使い、ビルド後の `dist/` を静的ホスティングへ配信する構成にしている。

構成:

```text
index.html
styles.css
package.json
bun.lock
biome.json
vite.config.ts
tsconfig.json
scripts/dev.ts
src/app.ts
src/audioFileAnalysis.ts
src/pitchMath.ts
src/pitchDetection.ts
src/graphModel.ts
src/session.ts
src/gameEffects.ts
src/*.test.ts
public/
assets/
docs/
```

ローカル確認は Dev Container 内の Bun + Vite を使い、可能であれば外部ブラウザで開く。

Dev Container では以下で起動できる。

```sh
bun run dev
```

このコマンドは Vite の開発サーバをコンテナ内の 5173 番で起動し、起動時に Dev Container のホスト側URLである `http://localhost:35173/` も表示する。
Vite の dev server と preview server は、ボーカル抽出で使う SharedArrayBuffer を有効にするため、Cross-Origin-Opener-Policy と Cross-Origin-Embedder-Policy をレスポンスヘッダに付与する。

Vite dev server では、巨大なモデルと BS-RoFormer 変換用の `.tmp/onnx-tools` Python venv を監視対象から外す。これらを監視すると、初回アクセス時に多数のファイルを走査して表示完了が遅くなる。

確認用コマンド:

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

`bun run build` で生成される `dist/` を GitHub Pages または Cloudflare Pages に配信する。Cloudflare Pages や手元で `dist/` を配信する場合に RMVPE / CREPE を使うには、build 前に `bun run download:pitch-models` を実行して `public/models/` に ONNX モデルを取得する。GitHub Pages デプロイでは GitHub Actions が取得して Pages artifact に含める。

## ビルドバージョン表示

画面フッターには、ビルド時点のバージョン情報を表示する。

- 表示バージョンはビルド時に自動生成し、手動でインクリメントしない
- 通常ビルドでは `0.1.<build>` の SemVer 形式を使う
- GitHub Actions では `<build>` に `GITHUB_RUN_NUMBER` を使う。これは workflow の実行番号であり、Pull Request や手動実行による欠番を含むことがある
- ローカルビルドでは `<build>` に `git rev-list --count HEAD` を使う
- major / minor を変えたい場合は、リポジトリ変数 `APP_VERSION_BASE` に `1.0` など `major.minor` 形式の値を指定する。未設定時は `0.1` を使う
- `APP_VERSION_BASE` は `major.minor` 形式、タグ名は `v1.2.3` などの SemVer 形式のみ許可する
- SemVer タグからビルドされた場合は `GITHUB_REF_NAME` の `v` を除いた値を優先して使う
- コミット識別子は GitHub Actions では workflow から渡す `APP_COMMIT_HASH`、ローカルビルドでは `git rev-parse --short=12 HEAD` から取得する
- Pull Request の CI では、一時的な merge commit ではなく PR head commit を `APP_COMMIT_HASH` に渡す
- 現行の GitHub Pages デプロイは `main` への push と SemVer タグへの push で実行する

例:

```text
Version v0.1.123 (c8c76eaffa70)
Version v1.0.0 (c8c76eaffa70)
```

## 実装済みの主な機能

- 目標音の選択
- 音域の選択（C3-C4 / C4-C5 / C5-C6、声の高さの目安つき）
- 半音を含む1オクターブ分の目標音選択
- 参考音の継続再生と停止
- 参考音量の調整
- ドレミ再生
- マイク入力の開始・停止
- 複数マイクがある場合の入力デバイス選択
- マイク音量と検出信頼度の表示
- 音程の時間変化グラフ
- 目標音を中心に上下6半音、合計1オクターブの音名レーンを表示
- 目標音に近いほど強くなる発光、許容範囲に入った瞬間の波紋、連続キープ時間の表示
- 練習サマリーの表示
- 音源ファイルまたは動画ファイルをブラウザ内で読み込み、歌声らしいピッチから声域を推定表示
- WebGPU 対応ブラウザでは Demucs / RoFormer 系モデル / ONNX Runtime Web によるボーカル抽出を任意で実行
- 音源ファイル解析では RMVPE / pitchy / CREPE small / medium / large / full を選択可能
- 解析用音源または別指定の再生用音源を再生し、声域グラフ上の現在位置を表示
- 開発用にピッチ推定モデル比較PNGと全ボーカル抽出モデルMP3を出力

## UI設計方針

リアルタイム音程は声の揺れ、倍音、ノイズ、マイク入力の影響で変化しやすい。そのため、瞬間的な音程表示よりも「音程の時間変化」グラフを主役にしている。

補助情報:

- 音量
- 信頼度
- 状態メッセージ
- 練習サマリー

## マイク入力について

ブラウザの制約により、マイク入力は表示方法に依存する。

確認方針:

- `index.html` は Vite 経由で TypeScript を読み込むため、`file://` で直接開かない
- Dev Container のホスト側URLである `http://localhost:35173/` などを外部ブラウザで開くのが望ましい
- GitHub Pages や Cloudflare Pages のような HTTPS 静的配信ではマイク利用が可能

複数マイク環境に対応するため、入力マイク選択UIを用意している。

注意:

- マイク権限を許可する前は、ブラウザ仕様によりデバイス名が表示されないことがある
- 一度マイク開始を許可すると、実デバイス名が表示されることが多い

## 参考音について

参考音は Web Audio API の `OscillatorNode` で生成している。

現在の動作:

- `参考音` ボタンを押すと、現在の目標音を継続再生する
- `停止` ボタンを押すと再生を止める
- 再生中に目標音を変更すると、鳴っている参考音も新しい目標音に追従する
- 参考音量スライダーで継続再生中の音量も変更できる
- `ドレミ再生` は短音を順番に鳴らす

注意:

スピーカーから参考音を鳴らしながらマイク解析すると、マイクが参考音を拾い、発声音と混ざる。音程検出の安定性に影響するため、以下の対応を検討する。

iOS では Safari / Chrome などブラウザアプリを問わず、マイク開始後に参考音へ周期的なノイズが乗る場合がある。マイク使用により iOS の音声入出力モードが切り替わり、Web Audio API の出力に影響している可能性が高い。現在は画面上に注意を表示し、参考音を止めてから練習を開始する運用を案内している。

- ヘッドホン利用を案内する
- 参考音再生中の解析を補正する
- 参考音と発声練習を時間的に分ける

## 音程検出

音程検出には `pitchy` の McLeod Pitch Method を使っている。`pitchy` は MIT ライセンスで配布され、ブラウザで `Float32Array` を直接扱えるため、Web Audio API のマイク入力と相性がよい。

現在の処理:

- `AnalyserNode.getFloatTimeDomainData()` で取得した波形を `pitchy` に渡す
- McLeod Pitch Method の検出結果と clarity を取得する
- 検出結果が目標音の上下1オクターブに入っているか確認する
- clarity と目標音からの近さを使って採否を決める
- 音量が小さい場合は検出しない

## 音源ファイル解析

音源ファイル解析は `src/audioFileAnalysis.ts` に分離している。メディアファイルから PCM データを取り出す処理は `src/mediaAudioExtraction.ts`、任意のボーカル抽出は `src/vocalSeparation.ts` に分離している。

現在の処理:

- `input[type="file"]` で選択された音源または動画を読み込む
- まず `AudioContext.decodeAudioData()` で読み込み、失敗した場合は Mediabunny で音声トラックを取り出す
- ボーカル抽出が有効な場合は、Demucs または RoFormer 系モデル / ONNX Runtime Web / WebGPU で抽出したボーカル音声を解析対象にする
- 複数チャンネルの音源はブラウザ内でモノラルにミックスする
- 既定では RMVPE、通常のPCやスマートフォンなど軽い環境では `pitchy` で短いフレームごとにピッチを検出する
- CREPE 推定が有効な場合は、音源を 16kHz にリサンプルし、CREPE の ONNX モデルを ONNX Runtime Web / WebGPU で実行してピッチを検出する
- RMVPE 推定が有効な場合は、RMVPE 用に 16kHz の log-mel spectrogram をブラウザ内で作成し、`rmvpe.onnx` を ONNX Runtime Web / WebGPU で実行する
- RMS と clarity が低いフレーム、声域として広すぎる周波数帯のフレームは除外する
- 近傍の検出結果から孤立した外れ値やオクターブ誤認らしい点を抑える
- 検出した MIDI 値から推定声域、よく出る範囲、中心付近、検出割合を集計する
- 解析用音源、またはチェックボックスで有効化した別の再生用音源をブラウザ内の一時URLで再生し、再生位置に合わせてグラフを横スクロールする
- ボーカル抽出後は、抽出ボーカルをメモリ上に保持し、再生対象を元音源または抽出ボーカルから選択できる。再生用には WAV Blob の一時URLを使い、保存時は `@mediabunny/mp3-encoder` で MP3 Blob に変換してダウンロードする

注意:

ボーカル抽出は WebGPU 対応ブラウザを優先する。スマートフォンや WebGPU 非対応ブラウザでは利用できない場合がある。初回は ONNX Runtime Web の WASM ファイルとモデル取得の外部通信が発生するが、音声データや解析結果は外部へ送信しない。

抽出モデルは以下を選べる。

- Demucs v4: 既存の `demucs-web` 経由。既定モデルは Hugging Face 上の `timcsy/demucs-web-onnx` の `htdemucs_embedded.onnx`（約172MB）。アプリ側ではモデルを一度取得して ONNX Runtime session に読み込み、Demucs のセグメントを処理する。複数 session の WebGPU 並列は VRAM / メモリ使用量が増え、環境によっては ONNX Runtime WebGPU の `getBindGroupLayout` エラーや WASM memory access out of bounds を誘発するため、既定では1並列にする。検証用に `VITE_DEMUCS_PARALLEL_SEGMENTS=2` で2並列を試せる。
- BS-RoFormer fp16 2-stem: 同じ RoFormer 推論パイプラインで実行する。`xycld/BS-RoFormer-ONNX` の fp32 ONNX + external data 版を `bun run prepare:bs-roformer-webgpu` で単一ONNXに内包してからfp16化し、大きな Split / Concat 分割を行って `public/models/bs-roformer-fp16-webgpu.onnx`（約310MB目安）として生成する。公開ビルドでは `VITE_BS_ROFORMER_FP16_MODEL_URL` が指定された場合のみ BS-RoFormer 選択肢を表示する。
- BS-RoFormer 系は ONNX Runtime Web の graph optimization level を `disabled` にし、過度な演算融合も避ける。モデル入力の time frame が 801 固定のため、チャンクサイズは約8秒から変えない。配布元の注意に従い、商用利用では学習データ条件を追加確認する。

RoFormer 系モデルの URL は必要に応じて `VITE_BS_ROFORMER_FP16_MODEL_URL` で差し替える。未指定の公開ビルドでは、存在しないローカルモデルへのリクエストを避けるため BS-RoFormer を選択不可にする。

BS-RoFormer のローカル検証では、Dev Container 内で `bun run prepare:bs-roformer-webgpu` を実行して `public/models/` にローカルONNXを生成する。このスクリプトは `.tmp/onnx-tools` に Python venv を作り、`onnx` / `onnxconverter-common` / `numpy` をインストールして変換する。`python3-venv` がないコンテナでは `sudo apt-get update && sudo apt-get install -y python3-venv` を先に実行する。

Demucs / ONNX Runtime Web の実行では SharedArrayBuffer が必要になる場合があるため、公開環境では Cross-Origin-Opener-Policy と Cross-Origin-Embedder-Policy のレスポンスヘッダが必要になる。Cloudflare Pages 向けには `public/_headers` を配置している。GitHub Pages ではこのヘッダを設定できないため、ボーカル抽出は動かない可能性がある。

ライセンス面では、Mediabunny と `@mediabunny/mp3-encoder` は MPL-2.0、MP3 エンコードで使う LAME は LGPL、demucs-web、ONNX Runtime Web、onnxcrepe、VoiceConversionWebUI の RMVPE モデルは MIT として扱う。RoFormer 系の実行コードと既定参照モデルも配布元の MIT 表記を前提に扱うが、BS-RoFormer は配布元が商用前の学習データ条件確認を推奨しているため、その注意をUI、ドキュメント、`public/THIRD_PARTY_NOTICES.txt` に残す。ONNX Runtime Web の依存に Apache-2.0、BSD-3-Clause、ISC のパッケージが含まれるため、`public/THIRD_PARTY_NOTICES.txt` に追記している。Workers Static Assets の単一ファイルサイズ上限を避けるため、ONNX Runtime Web の WASM ファイルはアプリに同梱せず jsDelivr から実行時に取得する。Demucs のボーカル抽出モデルもアプリに同梱せず、既定では Hugging Face 上の `timcsy/demucs-web-onnx` の `htdemucs_embedded.onnx` を実行時に取得する。BS-RoFormer は開発時に `public/models/bs-roformer-fp16-webgpu.onnx` を生成して使い、公開ビルドでは `VITE_BS_ROFORMER_FP16_MODEL_URL` で配信用 URL を指定した場合のみ有効にする。CREPE 推定モデルは GitHub Releases 直リンクがブラウザの CORS 制約に当たりやすいため、アプリ実行時は `models/crepe-small.onnx`、`models/crepe-medium.onnx`、`models/crepe-large.onnx`、`models/crepe-full.onnx` を参照する。RMVPE モデルも `models/rmvpe.onnx` を参照する。これらは GitHub Pages のサブパス配信でも解決できるように相対URLにしている。ONNX モデルは Git リポジトリにはコミットせず、ローカルでは `bun run download:pitch-models`、GitHub Pages デプロイでは GitHub Actions の `Download pitch models for GitHub Pages` ステップで `public/models/` に取得してから build する。ランタイムで別モデルを使う場合は `VITE_RMVPE_MODEL_URL`、`VITE_DEMUCS_MODEL_URL`、`VITE_BS_ROFORMER_FP16_MODEL_URL` を使う。`VITE_CREPE_MODEL_URL` は現状 CREPE small の差し替えにのみ使い、ダウンロード元の差し替えは `CREPE_SMALL_MODEL_SOURCE_URL` など size 別の環境変数を使う。

音源グラフは、短いフレームごとの検出点を薄い点群で表示し、近傍中央値から作った中心線を重ねる。ピッチ検出は子音、息、リバーブ、分離ノイズで瞬間的に乱れるため、全点を連続線で結ばない。音源再生中は現在位置を縦線で描画し、長いグラフでは現在位置が見えるようにスクロール位置を更新する。

開発用ツールとして、同じ解析用音源を全ボーカル抽出モデルで順番に処理し、抽出ボーカルをモデルごとの MP3 として出力できる。比較出力は `src/app.ts` の `handleVocalSeparationComparisonCapture()` が担当し、各モデルの失敗はログに残して次のモデルを続行する。ローカルONNXを生成していないBS-RoFormerモデルは取得エラーとして失敗扱いになる。

## 技術構成

Node.js は開発・ビルドに使うが、サーバアプリにするわけではない。

表示フォントは Google Fonts から読み込む。ボーカル抽出を有効にした場合は分離モデルを外部から取得する。音声解析とマイク入力は引き続きブラウザ内で完結し、音声データや解析結果を外部へ送らない。

```text
開発時:
Node.js / Bun + Vite + TypeScript + npm package

ビルド後:
HTML / CSS / JavaScript の静的ファイル

配信:
GitHub Pages または Cloudflare Pages
```

GitHub Pages や Cloudflare Pages への静的配信は、この方針と相性がよい。

## アプリアイコン

アプリアイコンのオリジナル画像は `assets/originals/app-icon.png` に置く。`public/` 配下の favicon や画面表示用ロゴは、この画像から生成した配信用画像として扱う。

現在の生成先:

- `public/favicon.png`: 64x64
- `public/apple-touch-icon.png`: 180x180
- `public/icons/app-logo.png`: 128x128

再生成する場合は、ImageMagick の `convert` を使う。

```sh
convert assets/originals/app-icon.png -resize 64x64 public/favicon.png
convert assets/originals/app-icon.png -resize 180x180 public/apple-touch-icon.png
convert assets/originals/app-icon.png -resize 128x128 public/icons/app-logo.png
```

## 音程検出ライブラリ

現在の採用:

- マイクのリアルタイム音程検出: `pitchy`
- 音源ファイル解析の軽量推定: `pitchy`
- 音源ファイル解析の推奨推定: `RMVPE` ONNX / WebGPU
- 音源ファイル解析の比較用推定: `CREPE small / medium / large / full` ONNX / WebGPU

将来の改善候補:

- WASMベースの pitch detection library

選定基準:

- ブラウザでリアルタイム動作できること
- マイク入力の `Float32Array` を直接扱えること
- 音声・歌声・発声に対して安定していること
- オクターブ誤認が少ないこと
- Viteでバンドルできること
- GitHub Pages / Cloudflare Pages の静的配信で動くこと

## 静的配信方針

配信先:

- GitHub Pages
- Cloudflare Pages

Vite構成では、`bun run build` で生成される `dist/` を配信すればよい。

サーバ側で音声解析は行わない。リアルタイム音程検出はブラウザ内で行う。

理由:

- 低遅延
- プライバシー面で扱いやすい
- 音声データをサーバへ送らない
- 静的ホスティングで運用できる
- コストが低い

## 今後の改善候補

1. 実機での音程検出安定性を継続確認する
2. 参考音再生中のマイク回り込みの影響を抑える
3. グラフ表示を実測に合わせて調整する
4. スマートフォン、タブレットでの表示とマイク入力を確認する
