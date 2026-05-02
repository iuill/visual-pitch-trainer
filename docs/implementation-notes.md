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
src/app.ts
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

このコマンドは Vite の開発サーバを起動し、通常は `http://localhost:5173/` でアプリを配信する。

確認用コマンド:

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

`bun run build` で生成される `dist/` を GitHub Pages または Cloudflare Pages に配信する。

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
- Vite が提供する `http://localhost:5173/` などのURLを外部ブラウザで開くのが望ましい
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

## 技術構成

Node.js は開発・ビルドに使うが、サーバアプリにするわけではない。

表示フォントは Google Fonts から読み込む。音声解析とマイク入力は引き続きブラウザ内で完結し、フォント取得以外の目的で音声データや解析結果を外部へ送らない。

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

- `pitchy`

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
