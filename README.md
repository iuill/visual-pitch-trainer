# Visual Pitch Trainer

[![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS-3-1572B6?logo=css&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.0.10-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3.13-000000?logo=bun&logoColor=white)](https://bun.sh/)

[English README](README_en.md)

難聴者向けに、音程練習を視覚的に支援するWebアプリです。

参考音（ド・レ・ミなど）を再生しながら、利用者の発声をマイクでリアルタイム分析し、目標音とのズレや時間経過による音程の上下を画面上に表示します。

## 目的

- 難聴者が視覚情報を使って音程を把握できるようにする
- 参考音に合わせた発声練習を行えるようにする
- 発声中の音程変化をリアルタイムに確認できるようにする
- PC、タブレット、スマートフォンのブラウザで利用できるようにする

## 基本方針

Visual Pitch Trainer は、サーバなしで動作する静的Webアプリです。

音声解析、参考音再生、グラフ描画、練習中の判定はすべてブラウザ内で処理します。これにより、低遅延で動作し、音声データをサーバに送信しないプライバシー面でも扱いやすい構成にします。

画面表示には Google Fonts を利用します。そのためフォント取得のための外部通信は発生しますが、マイク入力や解析した音程データは外部サービスへ送信しません。

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

ブラウザで Vite が表示するローカルURL、通常は `http://localhost:5173/` を開いてください。

基本的な検証コマンドは以下です。

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

`dist/` を GitHub Pages または Cloudflare Pages の配信ディレクトリに指定すれば、サーバなしで公開できます。

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

マイク入力はブラウザや表示方法によって制限されます。VS Code 内部のプレビュー画面でマイクが使えない場合は、Vite の `http://localhost:5173/` などのURLをChrome、Edge、Safariなどの外部ブラウザで開いてください。

このリポジトリの `index.html` は Vite 経由で TypeScript を読み込むため、直接ファイルとして開くのではなく、`bun run dev` または `bun run preview` で配信して確認します。マイク入力は HTTPS、`localhost`、`127.0.0.1` などの安全なコンテキストで利用できます。

## 技術構成

- HTML
- CSS
- TypeScript
- Vite
- Bun
- pitchy
- Web Audio API
- Canvas
- Google Fonts（表示フォント）
- localStorage または IndexedDB（履歴保存を追加する場合）

詳細は [docs/design.md](docs/design.md) を参照してください。
