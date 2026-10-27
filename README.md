# Visual Pitch Trainer

[![HTML](https://img.shields.io/badge/HTML-5-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS](https://img.shields.io/badge/CSS-3-1572B6?logo=css&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3.3-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Bun](https://img.shields.io/badge/Bun-1.3.13-000000?logo=bun&logoColor=white)](https://bun.sh/)

[English README](README_en.md)

難聴者向けに、発声練習と音源の声域確認を視覚的に支援するWebアプリです。

アプリ画面上の日本語表示名は「音程トレーニング道場」です。

参考音（ド・レ・ミなど）に合わせた発声をマイクでリアルタイム分析し、目標音とのズレや時間経過による音程の上下を画面上に表示します。ローカルの音源ファイルや動画ファイルから歌声らしい音程を推定し、伴奏入り音源ではブラウザ内のボーカル抽出を通して声域の目安を確認することもできます。

## 目的

- 難聴者が視覚情報を使って音程を把握できるようにする
- 参考音に合わせた発声練習を行えるようにする
- 発声中の音程変化をリアルタイムに確認できるようにする
- 音源や動画から歌声らしい音域を確認し、練習する曲選びや振り返りに使えるようにする
- 伴奏入り音源から抽出したボーカルを再生・保存できるようにする
- PC、タブレット、スマートフォンのブラウザで利用できるようにする

## 基本方針

Visual Pitch Trainer は、サーバなしで動作する静的Webアプリです。

音声解析、参考音再生、ボーカル抽出、ピッチ推定、グラフ描画、練習中の判定はブラウザ内で処理します。これにより、低遅延で動作し、マイク入力や音源ファイルをサーバに送信しないプライバシー面でも扱いやすい構成にします。

画面表示には Google Fonts を利用します。また、ボーカル抽出、MP3保存、RMVPE / CREPE 推定を有効にした初回実行時は、ブラウザ内で使う WASM ファイルやモデルを取得または読み込むための処理が発生します。音源解析用のピッチ推定モデルは公開成果物に含めます。マイク入力、音源ファイル、抽出ボーカル、解析した音程データは外部サービスへ送信しません。

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

画面上部で「単音練習」「メロディ練習」「ゲーム」「音源の声域確認」を切り替えます。タブより上の「共通設定」で、単音・メロディ・ゲームに使う音域・音色・音量・マイク・判定幅を変更します。閉じた状態でも現在の音域・音色・音量・判定幅を確認できます。単音の目標音やメロディの選択は各練習画面で行います。共通設定は音源の声域確認には適用しません。画面を切り替えると再生とマイクを停止し、読み込んだ音源の解析結果やメロディの振り返りは保持します。

- 半音を含む1オクターブ分の参考音を選択して再生できる
- C3-C4 / C4-C5 / C5-C6 の音域を声の高さの目安つきで選べる
- 参考音量を調整できる
- お手本音を正弦波・ピアノ・ハルモニウム・オルガン・バイオリン・フルートから選べる（単音・メロディ共通）
- マイク入力から現在の音程を検出できる
- 目標音との差をリアルタイムに表示できる
- 高い・低い・合っていることを視覚的に表現できる
- 時間経過による音程の上下をグラフで表示できる
- 音量、検出信頼度、連続キープ時間、練習サマリーを確認できる
- 音源ファイルや動画ファイルから歌声らしい音程を抽出し、声域の目安を表示できる
- 伴奏入り音源は、WebGPU 対応ブラウザではボーカルを抽出してから解析できる
- 抽出したボーカル音声を MP3 として保存できる
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

コンテナには Node.js、Bun、GitHub CLI (`gh`) などが入ります。Bun の期待バージョンは `.bun-version` と `package.json` の `packageManager` に記載しています。

GitHub CLI はホストの `~/.config/gh` をコンテナの `/home/node/.config/gh` へ読み書き可能な状態で共有し、`GH_CONFIG_DIR` に指定します。起動前にホストで `gh auth login` を済ませてください。コンテナ内でもホストと同じGitHub認証を使います。

Codex CLI はホストの standalone インストールを共有します。起動前にホストの `~/.codex/packages/standalone/current/bin/codex` が実行できることを確認し、ホストで `codex login` を済ませてください。コンテナ起動時にインストールの存在と実行可否を確認します。

`~/.codex/packages/standalone` 全体を同じパスへ読み取り専用でマウントし、`.devcontainer/bin/codex` が `HOST_CODEX_BIN` を実行します。コンテナ内で Codex を別途インストールせず、ホスト側の更新を使います。認証情報はホストの `~/.codex/auth.json` を `/home/node/.codex/auth.json` へ読み書き可能な状態で共有します。設定ファイルや会話履歴は共有しません。

ホストに `dc` がある場合は、このチェックアウトのルートで `dc codex` を実行できます。既存コンテナへ設定を反映するには `dc rebuild codex` を実行してください。ホスト側もコンテナの `linux/amd64` と互換性のある Linux 環境を前提とします。

このリポジトリでは、開発時のAIコーディングエージェントとして Codex を利用する前提で環境を整えています。エージェント向けのリポジトリルールは `AGENTS.md` にまとめ、Codex の Agent Skills は `.agents/skills/` 配下に配置しています。

依存パッケージは Bun に統一しています。lockfile がある場合は `bun install --frozen-lockfile`、ない場合は `bun install` を実行します。

`bunfig.toml` の `minimumReleaseAge = 1209600` により、依存関係の更新・新規解決は公開から14日以上経過したバージョンに限定します。更新には `bun update` を使い、メジャーバージョンを上げる場合は互換性を確認してください。明示的なバージョン指定や既存 lockfile のインストールでは公開日の制限を回避できるため、更新時は推移依存も含めて公開日を確認します。

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

Pages を手動更新する場合は、Actions の `Deploy Pages` → `Run workflow` で `main` を選択してください。監査・lint・テスト・型検査後にモデル取得・ビルド・公開を行います。`main` 以外はスキップします。`CI` の手動実行は検証のみです。

表示バージョンの実行番号は workflow ごとのため、自動公開と手動公開の間で重複や前後を含みます。コードの識別にはコミットハッシュを使ってください。

### メロディ稽古

専用グラフは練習前から全音のお手本を段々のバーで表示します。緑の横棒と帯がお手本、青い線が自分の声、黒い破線が現在位置です。音域と時間軸は固定し、終了後もお手本と声の軌跡を残します。12秒を超えるメロディでも最初の声を消しません。長いメロディは横にスクロールでき、再生中は現在位置を追います。終了後は自由に戻って確認できます。「音名を文字で確認」から音の一覧も読めます。

メロディ稽古では、ドレミ上行・下行、5音の往復、ドミソミド、半音階、自由メロディを選べます。自由メロディは空白で区切って2〜32音（例：ド ド ソ ソ ラ ラ ソ）を入力します。ド#などの半音と、高ド（1オクターブ上のド）も使えます。選択音域内の音を同じ長さで練習します。休符や音ごとの長さは未対応です。

マイク許可と音色の準備後、お手本1周（1音2秒固定）→ 3秒のカウントダウン → お手本と一緒に発声・判定1周と進みます。「発声練習の1音の長さ」は発声パートだけに適用し、1〜5秒（既定2秒）から選べます。待機中はグラフ上の大きな3・2・1と進捗バーを表示し、画面外なら見える位置へ移動します。準備の3拍と開始を音で知らせる設定もあり、共通設定のお手本音量を使います。合図音はオフにできます。現在の音・残り時間・進捗を示し、グラフの目標音も連動します。各音の最初の0.4秒は移動の猶予として判定から除きます。終了後は音ごとの合った時間・割合・音程検出時間を表示します。割合は猶予を除く予定時間に対する値で、無音・検出不能も分母に含みます。

ヘッドホンを使ってください。お手本音の回り込みを声と区別できず、発声していなくても正解になる場合があります。難聴者の練習効果は未検証です。中止、目標音・音域・音色変更、タブを離れた場合はメロディとマイクを停止します。

メロディ稽古では、バーのそばに上昇・下降・同じ高さを表す図形アイコンと、音の移動量バッジを表示し、バー同士を線でつなぎます。「半音」「全音」「1オクターブ」、それ以外は「半音4個分」と表記し、「上げる」「下げる」を添えます。全音には「半音2個分」も補足します。次に向かうバッジは金色、再生中のバーは太線と進捗で強調します。グラフ直上のNEXT欄でも同じアイコンと次の音名を確認できます。音名一覧にも「半音4個分上げる」のような説明を載せます。

バーの下に、実際のピアノと同じA0〜C8の88鍵を低めの高さで表示します。見出しや説明文を省き、現在／次の音名と鍵盤だけに絞ります。横にスクロールでき、「いま」と「つぎ」が範囲外になると見える位置へ移動します。お手本の「いま」は発光・明滅と周囲の光、お手本の切り替わりに合わせた小さな火花、「つぎ」は淡い色と点線枠で示します。鍵盤上に文字や丸・ひし形は重ねず、現在／次の音名を左下に表示します。「動きを減らす」設定では明滅と周囲のエフェクトを止めます。黒鍵やオクターブ違いも別の位置で示し、同じ音が続く場合は同じ鍵盤に発光・明滅と点線枠を併記します。待機中は発声の先頭に戻り、最後の音には次の鍵盤を強調しません。声の検出位置を示す鍵盤ではありません。音と鍵盤位置の対応を掴みやすくする試みで、練習効果は未検証です。

### 音程ゲーム（試作）

「ゲーム」で次の2種類を選べます。問題数は5問 / 10問、音域や判定幅は共通設定を使います。

モードはアイコンと短い説明付きのカードで選びます。問題数・キープ時間・音当ての難易度も、一覧のボタンから直接選べます。選択中は枠とチェックで示し、キーボードではTabで項目へ移動し、矢印キーで選択を変えられます。ゲーム中は設定を変更できません。

- 発声チャレンジ：3秒の視覚カウントダウン後にランダムな目標音を表示します。1秒以内に許容幅へ入り、その後1 / 2 / 3 / 5秒連続してキープすると成功です。時間切れ・音程外れ・無音・検出不能・長い検出間隔では失敗になります。目標が出る前の時間はキープに加算しません。出題中はお手本音を鳴らさず、画面の目標バーと自分の声の軌跡を使います。
- 音当て：ランダムな音を聴き、表示された音名から答えます。やさしいモードは3半音間隔の5択、むずかしいモードは半音間隔の13択です。聴き直しは何度でも可能で、回答後に正解を文字でも示し、自分で次の問題へ進みます。マイクは使いません。

成功すると100点、連続成功では1問ごとに25点ずつボーナスが増えます。目標に合った瞬間の表示、キープ中の発光、成功時の粒と効果音、終了ランク、最大連続成功で達成を知らせます。失敗しても獲得済みの点数は減りません。効果音はオフにでき、動きを減らす端末設定では粒とアニメーションを止めます。完走時の自己ベストを設定別にlocalStorageへ保存し、「もう一度挑戦」から繰り返せます。通常練習のスコア・自己ベストとは別です。

実際の発声での難易度や練習効果は未検証です。ゲーム中の共通設定変更、画面切り替え、タブ非表示、中止では再生とマイクを停止します。音声の保存や外部送信は行いません。

### お手本の音色

正弦波・ピアノに加えて、ハルモニウム・オルガン・バイオリン・フルートを選べます。追加4音色は CC0 の録音から持続部分を切り出し、継ぎ目をクロスフェードしたループを使います。ピアノのように繰り返し打鍵せず、お手本音を停止するまで伸ばします。メロディ稽古でも指定した音の長さまで伸ばします。生演奏の細かな音量・音程の揺れは残ります。

オルガンは VCSL、バイオリンとフルートは VSCO 2 CE、ハルモニウムは Donya Quick の Freesound 録音を利用しています。追加容量は計約2 MBで、選んだ音色を初めて使うときにアプリと同じ配信元から読み込みます。録音の実測音程に合わせて再生速度を補正します。バイオリンの G3 未満、フルートの C4 未満、ハルモニウムの D5 より上は録音音域外の移調加工音です。出典・加工内容・チェックサム・CC0 全文は各音色の public/audio/ 配下に含めます。音源を再生成するときだけ Bun・ffmpeg を用意して bun run prepare:reference-sustains を実行します。通常のビルドには外部音源の取得は不要です。

正弦波は鳴り続け、ピアノは自然に減衰する打鍵音を約2.5秒ごとに繰り返します。音程・声の高さ・音量の変更にも追従します。音色変更は再生中のお手本音に反映し、メロディ稽古中はメロディを停止します。

ピアノは Versilian Studios の [VCSL](https://github.com/sgossner/VCSL) に含まれる CC0-1.0 のグランドピアノ録音を使用しています。商用利用・改変・再配布が認められ、ロイヤルティやクレジット表記の義務はありません。出典とライセンスは `public/THIRD_PARTY_NOTICES.txt` と `public/audio/piano/` に同梱しています。素材のライセンスはアプリ本体の MIT ライセンスとは別です。

録音10点（計約3.5 MB）はアプリと同じ配信元から初回再生時に読み込み、そのページ内で再利用します。外部音源サービスや新規 npm パッケージは使いません。通常のインストール・ビルドに音源取得は不要です。音源を再生成する場合だけ ffmpeg を用意して `bun run prepare:reference-piano` を実行します。取得元は固定コミット・SHA256 で検証されます。

### マイク入力

マイク入力はブラウザや表示方法によって制限されます。VS Code 内部のプレビュー画面でマイクが使えない場合は、Dev Container のホスト側URLである `http://localhost:35173/` などをChrome、Edge、Safariなどの外部ブラウザで開いてください。

このリポジトリの `index.html` は Vite 経由で TypeScript を読み込むため、直接ファイルとして開くのではなく、`bun run dev` または `bun run preview` で配信して確認します。マイク入力は HTTPS、`localhost`、`127.0.0.1` などの安全なコンテキストで利用できます。

### 音源ファイルの声域推定

音源ファイルや動画ファイルを読み込み、ブラウザ内で歌声らしい音程の範囲を推定します。音声ファイルは `AudioContext.decodeAudioData()` で読み込み、動画やブラウザ標準で読み込めない形式は Mediabunny を使って音声トラックを取り出します。実際に解析できる形式はブラウザの WebCodecs / Web Audio API 対応にも依存します。Apple Music などの DRM 付き音源は解析できません。

伴奏入り音源を使う場合は、「ボーカルを抽出してから解析する」を有効にすると、Demucs / RoFormer 系モデル / ONNX Runtime Web / WebGPU を使ってブラウザ内でボーカル抽出を試します。抽出モデルは Demucs v4、BS-RoFormer から選べます。初回は ONNX Runtime Web の WASM ファイルと大きな分離モデルを取得するため時間がかかります。WebGPU 非対応のスマートフォンやブラウザでは使えない場合があり、その場合は抽出済みボーカル音源を読み込ませてください。

ボーカル抽出後は、音源の再生対象として元の音源または抽出ボーカルを選べます。抽出ボーカルはブラウザ内で MP3 に変換し、必要に応じて保存できます。

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

開発用の「全ボーカル抽出モデルMP3出力」では、同じ解析用音源に対して Demucs v4、BS-RoFormer fp16 2-stem を順番に実行し、実行可能なモデルの抽出ボーカルを個別の MP3 として出力できます。ブラウザによっては複数ファイルのダウンロード許可が必要です。

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
