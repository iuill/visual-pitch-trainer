# Visual Pitch Trainer

難聴者向けに、音程練習を視覚的に支援するWebアプリです。

参考音（ド・レ・ミなど）を再生しながら、利用者の発声をマイクでリアルタイム分析し、目標音とのズレや時間経過による音程の上下を画面上に表示することを目指します。

## 目的

- 難聴者が視覚情報を使って音程を把握できるようにする
- 参考音に合わせた発声練習を行えるようにする
- 発声中の音程変化をリアルタイムに確認できるようにする
- PC、タブレット、スマートフォンのブラウザで利用できるようにする

## 基本方針

初期バージョンは、サーバなしの静的Webアプリとして構築します。

音声解析、参考音再生、グラフ描画、練習中の判定はすべてブラウザ内で処理します。これにより、低遅延で動作し、音声データをサーバに送信しないプライバシー面でも扱いやすい構成にします。

```text
Browser
  ├─ Web Audio API
  ├─ Reference Tone Playback
  ├─ Microphone Input
  ├─ Pitch Detection
  ├─ Realtime Visualization
  └─ Practice Summary
```

## MVP

最初に作る範囲は以下を想定します。

- ドレミなどの参考音を選択して再生できる
- C3-C4 / C4-C5 / C5-C6 の音域を声の高さの目安つきで選べる
- 参考音量を調整できる
- マイク入力から現在の音程を検出できる
- 目標音との差をリアルタイムに表示できる
- 高い・低い・合っていることを視覚的に表現できる
- 時間経過による音程の上下をグラフで表示できる
- PC、タブレット、スマートフォンで使えるレスポンシブUIにする

## ドキュメント

- [設計メモ](docs/design.md)
- [実装メモ](docs/implementation-notes.md)

## ローカル起動

このアプリは Bun + Vite + TypeScript で開発し、ビルド後は `dist/` だけで動く静的Webアプリです。

### Dev Container

VS Code でこのリポジトリを開き、`Dev Containers: Reopen in Container` を実行してください。

コンテナには Node.js、Bun、GitHub CLI (`gh`)、OpenAI Codex CLI (`codex`) が入ります。Bun の期待バージョンは `.bun-version` と `package.json` の `packageManager` に記載し、Codex CLI は `.devcontainer/scripts/install-dev-tools.sh` でバージョンを指定してセットアップします。

既存の Dev Container で `codex` 実行時に CLI が見つからない場合は、ラッパーが `.devcontainer/scripts/install-dev-tools.sh` を実行して不足分をセットアップします。自動セットアップが失敗する場合は、コンテナ内で `bash .devcontainer/scripts/install-dev-tools.sh` を再実行してエラー内容を確認してください。

依存パッケージは Bun に統一し、`bunfig.toml` で公開直後のパッケージを既定で避ける設定にしています。lockfile がある場合は `bun install --frozen-lockfile`、ない場合は `bun install` を実行します。セキュリティ修正などで公開直後の依存へ更新する場合は、更新コマンドで release age の例外を明示します。

起動後、以下で Vite の開発サーバを開始できます。

```sh
bun run dev
```

ブラウザで Vite が表示するローカルURL、通常は `http://localhost:5173/` を開いてください。

型チェックと本番ビルドは以下です。

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

`dist/` を GitHub Pages または Cloudflare Pages の配信ディレクトリに指定すれば、サーバなしで公開できます。

### マイク入力

マイク入力はブラウザや表示方法によって制限されます。VS Code 内部のプレビュー画面でマイクが使えない場合は、Vite の `http://localhost:5173/` などのURLをChrome、Edge、Safariなどの外部ブラウザで開いてください。

ローカルに置いた `index.html` を直接ブラウザで開いてマイクが使える場合もありますが、ブラウザ依存のため、基本はローカルHTTPサーバ経由で確認します。

## 想定技術

- HTML
- CSS
- TypeScript
- Vite
- Bun
- pitchfinder
- Web Audio API
- Canvas
- localStorage または IndexedDB（履歴保存を追加する場合）

詳細は [docs/design.md](docs/design.md) を参照してください。
