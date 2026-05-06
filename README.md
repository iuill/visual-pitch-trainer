# Visual Pitch Trainer

[![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS-3-1572B6?logo=css&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.0.10-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3.13-000000?logo=bun&logoColor=white)](https://bun.sh/)

[English README](README_en.md)

難聴者向けに、音程練習を視覚的に支援するWebアプリです。

アプリ画面上の日本語表示名は「音程トレーニング道場」です。

参考音（ド・レ・ミなど）を再生しながら、利用者の発声をマイクでリアルタイム分析し、目標音とのズレや時間経過による音程の上下を画面上に表示します。

## 目的

- 難聴者が視覚情報を使って音程を把握できるようにする
- 参考音に合わせた発声練習を行えるようにする
- 発声中の音程変化をリアルタイムに確認できるようにする
- PC、タブレット、スマートフォンのブラウザで利用できるようにする

## 基本方針

Visual Pitch Trainer は、サーバなしで動作する静的Webアプリです。

音声解析、参考音再生、グラフ描画、練習中の判定はすべてブラウザ内で処理します。これにより、低遅延で動作し、音声データをサーバに送信しないプライバシー面でも扱いやすい構成にします。

画面表示には Google Fonts を利用します。また、ボーカル抽出や RMVPE / CREPE 推定を有効にした初回実行時は、ブラウザ内で使う ONNX Runtime Web の WASM ファイルや分離モデルを取得するための外部通信が発生します。音源解析用のピッチ推定モデルは公開成果物に含めます。マイク入力、音源ファイル、解析した音程データは外部サービスへ送信しません。

```text
Browser
  ├─ Web Audio API
  ├─ Reference Tone Playback
  ├─ Microphone Input
  ├─ Pitch Detection
  ├─ Realtime Visualization
  └─ Practice Summary
```

## 主な機能

- 半音を含む1オクターブ分の参考音を選択して再生できる
- C3-C4 / C4-C5 / C5-C6 の音域を声の高さの目安つきで選べる
- 参考音量を調整できる
- マイク入力から現在の音程を検出できる
- 目標音との差をリアルタイムに表示できる
- 高い・低い・合っていることを視覚的に表現できる
- 時間経過による音程の上下をグラフで表示できる
- 音量、検出信頼度、連続キープ時間、練習サマリーを確認できる
- 音源ファイルや動画ファイルから歌声らしい音程を抽出し、声域の目安を表示できる
- 伴奏入り音源は、WebGPU 対応ブラウザではボーカルを抽出してから解析できる
- WebGPU 対応ブラウザでは、RMVPE / CREPE の ONNX モデルで音源のピッチを推定できる
- 開発用に、既存の pitchy / CREPE / RMVPE の声域グラフを1枚のPNGで比較できる
- 解析対象または別指定の再生用音源を再生しながら、声域グラフ上の現在位置を確認できる
- PC、タブレット、スマートフォンで使えるレスポンシブUI

## ドキュメント

- [設計](docs/design.md)
- [実装方針](docs/implementation-notes.md)

## ローカル起動

このアプリは Bun + Vite + TypeScript で開発し、ビルド後は `dist/` だけで動く静的Webアプリです。

### Dev Container

VS Code でこのリポジトリを開き、`Dev Containers: Reopen in Container` を実行してください。

コンテナには Node.js、Bun、GitHub CLI (`gh`)、OpenAI Codex CLI (`codex`) などが入ります。Bun の期待バージョンは `.bun-version` と `package.json` の `packageManager` に記載しています。

`codex` コマンドが未セットアップの場合は、`.devcontainer/bin/codex` が `.devcontainer/scripts/install-dev-tools.sh` を実行して必要な開発ツールを準備します。

このリポジトリでは、開発時のAIコーディングエージェントとして Codex を利用する前提で環境を整えています。エージェント向けのリポジトリルールは `AGENTS.md` にまとめ、Codex の Agent Skills は `.agents/skills/` 配下に配置しています。

依存パッケージは Bun に統一しています。lockfile がある場合は `bun install --frozen-lockfile`、ない場合は `bun install` を実行します。

起動後、以下で Vite の開発サーバを開始できます。

```sh
bun run dev
```

Dev Container ではコンテナ内の Vite 開発サーバは 5173 番で起動し、ホスト側では `http://localhost:35173/` からアクセスできます。`bun run dev` は起動時にホスト側URLも表示します。
ローカル開発時の Vite dev server と `bun run preview` では、ボーカル抽出に必要な Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy ヘッダを返すように設定しています。

基本的な検証コマンドは以下です。

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

`dist/` を GitHub Pages または Cloudflare Pages の配信ディレクトリに指定すれば、サーバなしで公開できます。Cloudflare Pages や手元で `dist/` を配信する場合に RMVPE / CREPE を使うには、`bun run download:pitch-models` を build 前に実行して `public/models/` に ONNX モデルを取得してください。GitHub Pages デプロイでは GitHub Actions が取得して Pages artifact に含めます。

### CI

GitHub Actions で CI を実行します。

- `main` への push
- `v1.2.3` のような SemVer タグの push
- Pull Request
- 手動実行（`workflow_dispatch`）

CI では `.bun-version` の Bun を使い、依存関係を lockfile 固定でインストールした上で、以下を実行します。

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

`main` または SemVer タグへの push では、検証が通った後に `dist/` を GitHub Pages へデプロイします。初回は GitHub のリポジトリ設定で Pages の Build and deployment source を `GitHub Actions` に設定してください。

デプロイされたアプリのフッターには、ビルド時に自動生成したバージョンと短いコミットハッシュを表示します。通常の GitHub Pages デプロイでは `GITHUB_RUN_NUMBER` を使って `v0.1.N` のように自動採番するため、`package.json` などを手動でインクリメントする必要はありません。`N` は CI workflow の実行番号なので、Pull Request や手動実行による欠番を含むことがあります。タグからデプロイする場合は、`v1.2.3` のような SemVer タグ名をそのまま表示します。

### マイク入力

マイク入力はブラウザや表示方法によって制限されます。VS Code 内部のプレビュー画面でマイクが使えない場合は、Dev Container のホスト側URLである `http://localhost:35173/` などをChrome、Edge、Safariなどの外部ブラウザで開いてください。

このリポジトリの `index.html` は Vite 経由で TypeScript を読み込むため、直接ファイルとして開くのではなく、`bun run dev` または `bun run preview` で配信して確認します。マイク入力は HTTPS、`localhost`、`127.0.0.1` などの安全なコンテキストで利用できます。

### 音源ファイルの声域推定

音源ファイルや動画ファイルを読み込み、ブラウザ内で歌声らしい音程の範囲を推定します。音声ファイルは `AudioContext.decodeAudioData()` で読み込み、動画やブラウザ標準で読み込めない形式は Mediabunny を使って音声トラックを取り出します。実際に解析できる形式はブラウザの WebCodecs / Web Audio API 対応にも依存します。Apple Music などの DRM 付き音源は解析できません。

伴奏入り音源を使う場合は、「ボーカルを抽出してから解析する」を有効にすると、Demucs / RoFormer 系モデル / ONNX Runtime Web / WebGPU を使ってブラウザ内でボーカル抽出を試します。抽出モデルは Demucs v4、BS-RoFormer から選べます。初回は ONNX Runtime Web の WASM ファイルと大きな分離モデルを取得するため時間がかかります。WebGPU 非対応のスマートフォンやブラウザでは使えない場合があり、その場合は抽出済みボーカル音源を読み込ませてください。

ボーカル抽出後は、音源の再生対象として元の音源または抽出ボーカルを選べます。

伴奏入り音源を外部ツールで先に分離する場合は、抽出したボーカル音源をこのアプリに読み込ませます。Windows ホストで Docker Desktop と GPU が使える環境では、元音源があるディレクトリを PowerShell で開き、以下のように実行できます。この例は Windows ホストの PowerShell 向けで、CMD や WSL2 内での実行例ではありません。

```powershell
docker run --rm -it --gpus all -v ${PWD}:/workdir beveradb/audio-separator:gpu "input.mp3" --model_filename model_bs_roformer_ep_317_sdr_12.9755.ckpt --output_format MP3
```

ボーカル抽出は SharedArrayBuffer を使う実行環境を想定するため、公開環境では Cross-Origin-Opener-Policy と Cross-Origin-Embedder-Policy のレスポンスヘッダが必要になる場合があります。Cloudflare Pages では `public/_headers` を配信に含めます。GitHub Pages ではこのヘッダを設定できないため、ボーカル抽出が動かない可能性があります。

RoFormer 系の抽出モデルは実験的な高品質オプションです。BS-RoFormer は開発環境では `bun run prepare:bs-roformer-webgpu` で生成した `public/models/bs-roformer-fp16-webgpu.onnx` を参照し、WebGPU で実行します。このローカルモデルは、公開されている 2-stem vocals/instrumental ONNX の大きな Split / Concat を小さく分割し、WebGPU shader の storage buffer 上限に当たりにくくしたものです。公開ビルドで BS-RoFormer を有効にする場合は、`VITE_BS_ROFORMER_FP16_MODEL_URL` に配信用モデル URL を指定します。未指定の公開ビルドでは、存在しないローカルモデルを参照しないよう BS-RoFormer の選択肢を隠します。

Demucs v4 は既定で1つの ONNX Runtime session を使い、音源をセグメント単位で処理します。検証用に `VITE_DEMUCS_PARALLEL_SEGMENTS=2` を指定すると2並列を試せますが、VRAM / メモリ使用量が増え、環境によっては ONNX Runtime WebGPU が失敗することがあります。

BS-RoFormer をローカルで検証する場合は、Dev Container 内で以下を実行してから `bun run dev` を起動します。`python3-venv` がないコンテナでは先に `sudo apt-get update && sudo apt-get install -y python3-venv` を実行してください。

```sh
bun run prepare:bs-roformer-webgpu
```

音源や分離モデルによっては息、子音、リバーブ、ハモリ、分離ノイズが残るため、結果はあくまで声域の目安として扱います。

「ピッチ推定」では、音源ファイル解析の推定器を選べます。既定の `RMVPE` はゲーミングPCでの利用想定です。通常のPCやスマートフォンでは軽量な `pitchy`、比較したい場合は `CREPE small / medium / large / full` も選べます。マイクのリアルタイム音程検出は引き続き軽量な `pitchy` を使います。CREPE は公開成果物に含めた `yqzhishen/onnxcrepe` のモデル、RMVPE は公開成果物に含めた `lj1995/VoiceConversionWebUI` の `rmvpe.onnx` を使います。ランタイムで別モデルを使う場合は、ビルド時に `VITE_RMVPE_MODEL_URL`、`VITE_DEMUCS_MODEL_URL`、`VITE_BS_ROFORMER_FP16_MODEL_URL` を指定できます。`VITE_CREPE_MODEL_URL` は現状 CREPE small のランタイム差し替えにのみ使います。GitHub Actions やローカルのモデル取得元を変える場合は、`scripts/download-pitch-models.ts` の `CREPE_SMALL_MODEL_SOURCE_URL` など size 別の環境変数を使います。

開発用の「ピッチ推定モデル比較PNG出力」では、既存の `pitchy`、CREPE small / medium / large / full、RMVPE の結果を縦に並べた1枚のPNGを出力できます。RMVPE は同梱した `lj1995/VoiceConversionWebUI` の `rmvpe.onnx` を使います。

開発用の「全ボーカル抽出モデルWAV出力」では、同じ解析用音源に対して Demucs v4、BS-RoFormer fp16 2-stem を順番に実行し、実行可能なモデルの抽出ボーカルを個別の WAV として出力できます。ブラウザによっては複数ファイルのダウンロード許可が必要です。

CREPE / RMVPE の ONNX モデルはサイズが大きいため、Git リポジトリにはコミットしません。ローカルで必要な場合は `bun run download:pitch-models` で `public/models/` に取得できます。GitHub Pages へのデプロイでは、GitHub Actions がモデルを取得して Pages artifact に含めます。

## 技術構成

- HTML
- CSS
- TypeScript
- Vite
- Bun
- pitchy
- Mediabunny
- demucs-web
- ONNX Runtime Web
- CREPE / onnxcrepe
- RMVPE
- Web Audio API
- WebCodecs
- WebGPU
- Canvas
- Google Fonts（表示フォント）
- localStorage または IndexedDB（履歴保存を追加する場合）

詳細は [docs/design.md](docs/design.md) を参照してください。
