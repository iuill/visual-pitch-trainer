# 実装方針

## 現在の実装方針

現在は Bun + Vite + TypeScript を使い、ビルド後の `dist/` を静的ホスティングへ配信する構成にしている。

構成:

```text
index.html
model-comparison.html
styles.css
styles/
package.json
bun.lock
biome.json
vite.config.ts
tsconfig.json
scripts/dev.ts
src/app.ts
src/commonSettings.ts
src/practiceView.ts
src/melodyPracticeView.ts
src/gamePractice.ts
src/rhythmPracticeView.ts
src/voiceRangeCheck.ts
src/microphone.ts
src/audioContext.ts
src/audioFileView.ts
src/audioFilePlayback.ts
src/audioAnalysisPipeline.ts
src/onnxRuntime.ts
src/audioAnalysisProgress.ts
src/audioDownloads.ts
src/audioFileAnalysis.ts
src/audioRangeGraph.ts
src/singlePracticeGraph.ts
src/modelComparisonTool.ts
src/dom.ts
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

### 画面と音声処理の責務

- `src/app.ts` が6画面の切り替え順、共通設定変更の通知、ページのライフサイクルを扱う。切り替えでは共通設定の試聴を止め、離れる画面の `stop()`、`show(false)`、移る画面の `show(true)` の順で呼ぶ。各画面が自身の表示と記録を管理する。タブが非表示のときも参考音・再生・マイクを止める。通常のページ離脱では、登録した画面の実体ごとにリソースを解放する。単音とメロディは1つの実体を共有する。
- `hidden` は要素の非表示に使い、練習領域の `data-practice-mode` は単音・メロディのレイアウト切り替えに使う。メロディと声域チェックの画面ルートに付く `data-running` は開始準備と実行中の両方を表し、狭い画面の停止欄の配置に使う。
- `src/commonSettings.ts` が設定値、ダイアログと要約表示、マイク選択、音色の試聴を扱う。単音・メロディ練習、ゲーム、自分の声域チェックは共通設定から現在値を読む。設定変更への反応は各画面が決める。スライダー操作中の反映と、操作確定時にゲームや声域チェックを中止する通知は分ける。試聴を始める前の画面停止は `src/app.ts` が行う。
- `src/practiceView.ts` が単音・メロディの画面切り替えと共用のマイク入力を扱う。`src/singlePracticeView.ts` は単音の選択、判定、練習記録を持つ。`src/melodyPracticeView.ts` はメロディの進行、判定、音ごとの集計を持つ。両画面は `src/practiceReadout.ts` を通して状態・音量・検出信頼度を表示する。単音の選択音と練習記録はメロディから戻った後も保持する。試聴・単音・メロディは `src/app.ts` が遅延生成する同じ参考音プレーヤーを使う。
- `src/gamePractice.ts` と `src/voiceRangeCheck.ts` は初期化時に画面の要素を取得し、各ビューの関数内で実行中の状態を保持する。回答や記録済みの音など、実行中に生成する要素は表示時に更新する。
- `src/microphone.ts` がマイクの制約指定、入力ノードと波形バッファの準備、フレーム更新、停止と切断、許可待ちで無効になったストリームの解放を扱う。開始時に渡されたフレーム処理はマイク取得の成功後に動き始める。単音・メロディ・発声ゲームは `sampleTarget()`、自分の声域チェックは `sampleVoiceRange()` を使う。`src/pitchDetection.ts` が1フレームのRMSを計算し、「声の拾いやすさ」に応じて検出を実行する。検出信頼度の下限は同じモジュールに定義し、単音・メロディは0.52、発声ゲームは0.9、声域チェックは0.93とする。単音・メロディと発声ゲームは4096サンプル、自分の声域チェックは8192サンプルを使う。
- `styles.css` はアプリのCSSの入口とする。`styles/shared.css` が土台と共通部品を読み込み、画面固有のCSSと狭い画面の固定操作欄は `styles/` の各ファイルに置く。カスケードレイヤーの順序は `base`、`components`、`screens`、`utilities` とする。追加のスタイルシートは、役割に合ったレイヤーを指定して読み込む。開発用のモデル比較画面は `styles/comparison.css` から共通CSSと比較画面用のルールを読む。
- `src/graphCanvas.ts` は背景・目盛り・声の線・コンボの段階色など、画面とCanvasで共有する色をCSS変数から取得し、表示サイズの監視とCanvasの内部解像度を扱う。音源の声域グラフは表示とPNG出力の両方で、検出点の群れに濃い傾向線を重ねる。Canvasの内部サイズは寸法が変わった場合だけ更新する。
- 選択欄・入力欄・チェックボックスは共通の枠や状態表示を使う。選択肢の表示とキーボード操作はブラウザ標準の `select` に任せ、欄の幅は各画面の配置に合わせる。キーボードフォーカスはボタンと入力欄の共通アウトラインで示し、ゲームのラジオボタンは対応するカードに同じアウトラインを出す。
- 単音練習の開始時にグラフへスクロールする条件は、練習画面を1列にするCSSから読む。画面下に操作欄を固定する条件は幅520px以下とする。
- 単音・メロディ、試聴、音源再生は必要時に生成する共有の AudioContext を使い、ページの通常離脱時に閉じる。ゲームと声域チェックは開始ごとに専用の AudioContext を作り、停止時に閉じる。
- `src/audioFileView.ts` がファイル選択、結果の表示、再生用音源の長さの照合を扱う。`src/audioFilePlayback.ts` がプレーヤー、ゲイン、一時URL、再生要求、位置通知をまとめて管理する。`src/audioAnalysisPipeline.ts` がモデル確認、デコード、任意のボーカル抽出、推定、推定セッションの解放を行う。開始直後に解析操作をロックし、成功した結果をまとめて画面に反映する。画面を離れれば再生を一時停止し、解析と結果はページ内に保持する。`src/audioRangeGraph.ts` は解析結果からグラフを描き、開発用の比較出力でも使う。

ローカル確認は Dev Container 内の Bun + Vite を使い、可能であれば外部ブラウザで開く。

GitHub CLI はホストの `~/.config/gh` を `/home/node/.config/gh` に読み書き可能な状態で共有し、`GH_CONFIG_DIR` に指定する。コンテナ作成前に共有元ディレクトリを用意してパーミッションを700に設定する。ホストで `gh auth login` を済ませておく。

Codex CLI はホストの `~/.codex/packages/standalone` を読み取り専用で共有し、`HOST_CODEX_BIN` を通して起動する。認証情報はホストの `~/.codex/auth.json` を `/home/node/.codex/auth.json` に読み書き可能な状態で共有する。コンテナ作成前にホストの実行ファイルを検証し、認証ファイルがなければ空の JSON を作成する。ホストで `codex login` を済ませてから、チェックアウトのルートで `dc codex` を実行する。コンテナ内への Codex の個別インストールは行わない。

Dev Container では以下で起動できる。

```sh
bun run dev
```

このコマンドは Vite の開発サーバをコンテナ内の 5173 番で起動し、起動時に Dev Container のホスト側URLである `http://localhost:35173/` も表示する。Docker のポート公開は `127.0.0.1:35173:5173` とし、ホストへの公開先をループバックアドレスに限定する。
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

## 依存関係の更新方針

`bunfig.toml` の `minimumReleaseAge = 1209600`（14日）は維持する。更新時は npm の公開日時を確認し、直接依存・推移依存ともに14日以上経過した安定版を使う。明示的なバージョン指定や既存 lockfile は待機期間のフィルターを回避できるため、lockfile 全体の公開日も確認する。

2026-10-19 の更新では TypeScript 7、Vite 8.3、Biome 2.5、ONNX Runtime Web 1.30、Mediabunny 1.61 に更新した。`protobufjs` は古い固定 override を削除し、ONNX Runtime の互換範囲内の 7.6.6 に更新した。Biome 設定は `preset` に移行し、新しいアクセシビリティ検査に合わせ、名前付き操作群を `fieldset`、補足表示のフォーカス要素を `button` にした。fieldset の既定スタイルは CSS でリセットする。

2026-10-27 は、依存監査で検出された [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) に対応して Vite を8.3.2から8.3.3へ更新した。修正版の公開日は2026-10-06で、14日以上の経過を確認した。推移依存の解決結果は変更せず、監査の基準は維持する。

## Pages の手動公開

専用の `.github/workflows/deploy-pages.yml`（`Deploy Pages`）を `main` で手動実行する。監査・lint・テスト・型検査、モデル取得、ビルド後に公開する。他ブランチはスキップする。既存 CI の push 時自動公開と手動検証は維持する。実行番号は workflow ごとに採番されるため、表示バージョンの重複・前後はコミットハッシュで区別する。

## ビルドバージョン表示

画面フッターには、ビルド時点のバージョン情報を表示する。

- 表示バージョンはビルド時に自動生成し、手動でインクリメントしない
- 通常ビルドでは `v0.2 · Build <build>` のように、バージョン系列とビルド番号を分けて表示する
- GitHub Actions では `<build>` に `GITHUB_RUN_NUMBER` を使う。これは workflow の実行番号であり、Pull Request や手動実行による欠番を含むことがある
- ローカルビルドでは `<build>` に `git rev-list --count HEAD` を使う
- major / minor を変えたい場合は、リポジトリ変数 `APP_VERSION_BASE` に `1.0` など `major.minor` 形式の値を指定する。未設定時は `0.2` を使う
- `APP_VERSION_BASE` は `major.minor` 形式、タグ名は `v1.2.3` などの SemVer 形式のみ許可する
- SemVer タグからビルドされた場合は `GITHUB_REF_NAME` のバージョンを `v` 付きで表示する
- コミット識別子は GitHub Actions では workflow から渡す `APP_COMMIT_HASH`、ローカルビルドでは `git rev-parse --short=12 HEAD` から取得する
- Pull Request の CI では、一時的な merge commit ではなく PR head commit を `APP_COMMIT_HASH` に渡す
- 現行の GitHub Pages デプロイは `main` への push と SemVer タグへの push で実行する

例:

```text
Version v0.2 · Build 123 (c8c76eaffa70)
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

マイクの選択値はユーザーの指定だけを保持する。「既定のマイク」で開始したときに取得できた入力のデバイスIDを、次回開始時の`deviceId: { exact: ... }`へ昇格させない。使用中の入力名は`track.label`で表示し、選択値を上書きしない。iPhoneなどで停止後にデバイス情報が変わる場合にも、既定の入力はブラウザに選び直してもらう。明示的に選んだ入力は引き続きexact指定する。単音・メロディ・声域チェック・発声ゲームのマイク開始失敗時は共通の例外名と種類別の対処を表示する。音当ての音源準備エラーはマイクエラーとして扱わない。iPhone実機での再開動作は要確認。

注意:

- マイク権限を許可する前は、ブラウザ仕様によりデバイス名が表示されないことがある
- 一度マイク開始を許可すると、実デバイス名が表示されることが多い

## 参考音について

追加の持続音色（ハルモニウム、オルガン、バイオリン、フルート）は ReferenceInstrument の samples / playback: loop として定義する。AudioBufferSourceNode の loop を使い、単音参考音は再打鍵タイマーを作らず停止まで持続する。メロディの予約ノートも同じループを使い、ノートの終わりに停止する。音域・音程変更は近い録音を選び直し、旧ノードをフェードアウトする。音量変更と予約音の中止は既存の共通処理を使う。

scripts/reference-sustain-sources.json に固定 URL・SHA256・切り出し時刻を記録し、scripts/prepare-reference-sustains.ts で任意に再生成する。キャッシュは .tmp/reference-sources/。ffmpeg で44.1 kHzモノラルにし、持続区間を全周期に近い長さで切り出し、約40msのクロスフェードでループの継ぎ目を処理する。DC除去、ピーク0.7正規化後のループを使用し、ループ音程を pitchy で測って再生速度の基準にする。録音本来のアタック・リリースは含まない。生成物と出典は public/audio/ の音色別ディレクトリに保持する。ハルモニウムは CC0 の HQ MP3 プレビュー、ほかは固定コミットの WAV を元にする。

参考音は `src/referenceInstruments.ts` の音色定義と `src/referencePlayer.ts` の再生・読み込み・スケジューリングで扱う。正弦波は `OscillatorNode`、ピアノは `AudioBufferSourceNode` を使い、共通の GainNode で音量を制御する。外部再生ライブラリや音源サービスは追加しない。

共通設定の試聴は `src/referenceInstruments.ts` の音程と拍数から、設定音域の下端を主音にしたフレーズを作る。`ReferencePlayer.playPhrase()` が各音を同じ AudioContext の時計に予約し、音源と音量設定を共有する。音色・音域の変更や設定画面を閉じたときに予約と準備中のリクエストを取り消す。

ピアノには VCSL の CC0-1.0 グランドピアノ録音10点を同梱し、C3–C6 をカバーする。最寄りの録音を最大約2半音移調し、実測した元の音程を基準に playbackRate を補正する（元の VCSL ファイル名は中央ドを C3 とする表記）。`public/audio/piano/sources.json` に固定コミット、原音・加工後の SHA256、加工内容、実測ピッチを記録する。`bun run prepare:reference-piano` は任意の再生成処理で、ffmpeg が必要。通常ビルドでは同梱済み素材を使用する。

現在の動作:

- `お手本音` ボタンは正弦波を継続再生し、ピアノは約2.5秒間隔で2.4秒の打鍵音を繰り返す
- `停止` ボタンを押すと再生を止める
- 再生中に目標音を変更すると、鳴っている参考音も新しい目標音に追従する
- 参考音量スライダーで継続再生中の音量も変更できる
- `ドレミ再生` は短音を順番に鳴らす
- ピアノ初回再生時に約3.5 MBの録音を取得・デコードし、同時読み込みを共有してキャッシュする。失敗した音源は次回再試行できる
- 準備中の停止や音色変更はリクエスト世代で取り消し、完了後の意図しない再生を防ぐ。音色・目標音変更時は音階を中止し、予約済みノートも停止する

注意:

スピーカーから参考音を鳴らしながらマイク解析すると、マイクが参考音を拾い、発声音と混ざる。音程検出の安定性に影響するため、以下の対応を検討する。

iOS では Safari / Chrome などブラウザアプリを問わず、マイク開始後に参考音へ周期的なノイズが乗る場合がある。マイク使用により iOS の音声入出力モードが切り替わり、Web Audio API の出力に影響している可能性が高い。現在は画面上に注意を表示し、参考音を止めてから練習を開始する運用を案内している。

- ヘッドホン利用を案内する
- 参考音再生中の解析を補正する
- 参考音と発声練習を時間的に分ける

## メロディ稽古

`src/melodyPractice.ts` の2・3・5トーンは、共通設定の1オクターブ内にある長音階から、通常は開始位置に応じて指定音数の連続区間を取り出す。ランダムでは直前と異なる相対音列を候補にし、往路の各音が重複せず、隣り合う音の音階上の位置の差が設定以内の候補から均等に選ぶ。往路の最初と最後を除いた音を逆順で足し、1周を2・4・8音とする。折り返し音は往路の最後に鳴らし、開始音は次の周の頭で鳴らす。メロディを選び直すかランダムを有効にすると開始位置はドに戻る。開始音を手動で変更できる範囲は、音型の最も低い音と最も高い音が音域に収まるように求める。開始音や音型の変更はプレビューに反映する。発声中は、手動の開始音変更とランダムの「次の音型」を次の周に予約する。同じ周に「次の音型」を押し直すと、再生中と同じ相対音列と予約済みの同じ音列を候補から外し、予約を上書きする。カウントダウン中は最初の周に反映する。ランダムの移動幅設定は練習中は隠す。

画面は単音・メロディ・リズム練習・ゲーム・自分の声域チェック・音源の6ビューを同じDOM上で切り替える。hidden属性で非表示にする。共通設定はビューの外に置き、上部メニューの前に設定ボタンと現在の音域・音色・音量・判定幅を表示する。メロディ設定も専用ボタンと現在のメロディ・1音の長さを表示する。両方の設定画面はネイティブdialogのshowModal() / close()を使い、src/settingsDialog.tsが開閉ボタンと背景クリックを扱う。Escape・フォーカス制御はブラウザの標準動作を使う。画面内をスクロールでき、見出しと閉じるボタンは固定する。変更は即時反映し、練習開始時は設定画面を閉じる。お手本音の初期値はピアノとする。共通設定は単音・メロディ・ゲームに適用し、単音の目標音ボタンは単音ビュー内に置く。ビュー切り替えは参考音とマイクの要求を無効化して停止し、音源再生を一時停止する。解析結果は保持する。

src/melodyGraph.ts がメロディ専用Canvasを描画し、src/graphModel.ts の createMelodyGraphLayout() が全目標音から固定音域と1周分の座標を求める。Canvasは移動量バッジが重ならないよう1音112px以上を確保し、長いメロディは横スクロールする。声の描画データは通常の12秒サマリーとは別に約25Hz以下で現在の1周分だけ保持する。周回の切り替わりで描き直し、停止・ビュー切り替え後は停止した周回をお手本とともに残す。新しいメロディや長さ・音域を設定すると振り返りを初期化する。判定集計の頻度は変えず、描画用の保持だけを間引く。

メロディ稽古の音型・自由メロディ検証・段階判定・音ごとの集計は src/melodyPractice.ts に分離する。ReferencePlayer.playScale() に1音の長さ（0.5秒と1〜5秒）・開始時刻・初回3秒の準備・合図音設定・loop指定を渡す。最初の3・2・1・開始の合図音と、開始3秒後からのループ音を同じ AudioContext の時計へ予約する。ループ音は50ms間隔で200ms先まで予約し、長時間の練習でも予約ノード数を抑え、タイマー遅延時は過去の音をまとめて再生しない。開始音や音型の変更時は対象の周と同じ音数の音列を ReferencePlayer.replaceScaleLap() に渡す。先行予約済みのループ音はその周から同じ時刻に予約し直し、合図音は維持する。対象の周が始まっていた場合は次の周を指定し直す。トーンスケールのグラフは共通設定の音域を縦軸に使う。getMelodyPosition() は初回の準備後、周回番号と周回内の経過時間を同じ時計から求める。グラフの時間軸は1周の長さで固定する。カウントダウンはグラフに重ね、残り時間によって画面の高さを変えず、画面外ならスクロールする。合図音もstopScale()で予約音とともに中止する。UI と判定対象の目標音も同じ時計から求める。初回の準備中は集計せず、発声開始後にメロディの観測を記録する。周回の切り替わりでは描画サンプルと前回の検出をリセットし、音ごとの結果は累積する。開始音や音型が切り替わった場合は、区間ごとの開始周と結果を保持する。メロディ中は単音用のスコア・コンボを加算せず、自己ベストにも反映しない。各周回の最初の0.4秒は判定対象外。別音への移動と250ms超の検出間隔は連続正解時間に加えない。停止時に音ごとの結果を表示し、getMelodyAssessedSeconds() で停止までの各音の判定対象時間を求めて割合の分母とする。全周回と途中停止を扱い、無音・検出不能も含める。未練習の音は「—」とする。

開始要求に識別子を付け、音源ロード・マイク許可待ちの中止後に遅延再生や接続が復活しないようにする。終了、中止、音域・目標音・音色変更、タブ非表示時は予約済み音とマイクを停止する。回り込みと声の区別は行わずヘッドホンを案内する。iOS の同時入出力と実際の練習効果は実機で検証する。

`src/pitchMath.ts` の `formatPitchMovement()` で隣接するお手本周波数のMIDI差を整数の半音数へ変換する。同音、半音、全音、1オクターブを区別し、それ以外は「半音4個分」と表示する。全音の説明には半音2個分を補足する。度数名は使わず、同じ距離なら音名の綴りや移調によらず同じ案内にする。compact指定では方向アイコン用の短い移動量を返し、Canvasでは「上げる」「下げる」を添える。`src/pitchMovementVisual.ts` の共通パスをSVGとCanvasのPath2Dで使い、文字矢印への依存や外部アイコン依存を追加しない。Canvasでは次のバッジと接続線、再生中のバーと進捗を強調する。マイクの目標との差とは独立した表示とし、オクターブを折り返さない。`updateMelodyMovement()` はプレビュー、各音の切替、カウントダウン、終了時に更新する。自由メロディの不正入力時はNEXT欄と鍵盤を隠す。音名一覧にも同じ変換を使う。

`src/melodyKeyboard.ts` は `updateMelodyMovement()` から同じ音インデックスで更新する。`src/graphModel.ts` の `createPianoKeyboardLayout()` がMIDI21〜108（A0〜C8）の88鍵、白鍵52・黒鍵36の配置を求める。鍵盤本体は高さ90px、白鍵1つ20px以上で横スクロールさせる。見出し・凡例・説明文を省き、6pxの余白で鍵盤と左下の現在／次の音名行だけを表示する。鍵盤に丸・ひし形や「今／次」の文字は重ねない。DOMは初回だけ構築し、各音の切替では現在・次のクラスを更新する。`followMelodyKeyboard()` は両方の鍵盤が見える範囲へ移動し、画面幅変更・メロディ画面の再表示時にも呼ぶ。同一MIDIには現在と次の両方のクラスを付け、オクターブを折り返さない。現在の鍵盤には疑似要素を重ね、1.4秒周期で不透明度0.12〜0.75の明滅と内側の発光を与える。音が短い場合も変化が見えるよう、切替直後を強い色から始める。音名はその上に重ねて静止させ、prefers-reduced-motionでは明滅と周囲のエフェクトを止める。現在の鍵盤を囲う緑の枠は使わず、下端の細いアクセントに留める。絶対配置の`.melody-keyboard-effects`に現在列のX座標と鍵盤上下端のY座標を渡し、周囲に細い光と切替時の6個の火花を出す。スクロール・リサイズ・再表示時にも位置を合わせ、現在鍵盤が範囲外のときは非表示にする。エフェクトは音名行の手前でクリップし、レイアウトの高さや操作に影響させない。火花は更新時に置き換えて720msで消し、DOM数を固定する。次の鍵盤は淡い色と点線枠で示す。同音反復では発光・明滅と点線を併記する。視覚用の鍵盤はaria-hiddenとし、現在と次の音名は別のテキストでも提供する。スクロール領域にはキーボードでフォーカスできる。カウントダウンの重ね表示は鍵盤を含まないグラフ部分を基準にする。

## 音程ゲーム

設定UIはfieldset / legendでグループ化したネイティブradioを、モードカードと数字の選択ボタンとして表示する。`src/gamePractice.ts` の `selected()` でcheckedの値を読み、問題数・キープ時間・選択肢間隔・自己ベストのキーへ渡す。`gameMode` グループのchangeでモード別設定とステージを切り替える。開始中は親の`gameSettings` fieldsetのdisabledで全radioを無効化し、中止・終了時に戻す。フォーカスは対応するカードに表示し、hover / 押下の軽い動きはprefers-reduced-motionで止める。

`src/pitchGameModel.ts`がランダム出題、選択肢、到達・キープの状態遷移、ゲーム専用スコアとランクを扱う。到達期限は3000ms（境界を含む）、到達後の検出間隔が250ms超・無音・音程外れならキープ失敗とする。オクターブを同じ音として採点しない。各問の得点は100＋直前の連続成功数×25、失敗で連続数だけをリセットする。直前と同じ目標を避け、音当ての正解は実際の選択肢から選ぶ。

`src/gamePractice.ts`が専用AudioContext、ReferencePlayer、開始準備とゲーム進行を管理する。発声では`MicrophoneInput`のフレーム更新で検出し、準備と問間の効果音中は判定しない。音当てはマイクを取得せず、再生終了を`AnimationLoop`で確認してから選択肢を有効にし、回答を1回だけ受理する。準備要求は世代番号で取り消す。共通設定変更・中止・ビュー変更・pagehide・非表示でマイクと予約音を止め、結果だけ残す。

ゲーム開始時に設定を折りたたみ、画面をフィードバックへ移動する。目標への到達、キープの光、成功時の粒と任意の効果音、ランク・連続数・再挑戦を用意する。装飾はaria-hiddenで、判定文は別のstatusで提供する。prefers-reduced-motionではアニメーションと粒を止める。完走ベストは`pitch-games:v1:`接頭辞のlocalStorageへ、モード・問題数・音域・許容幅・感度・キープ長または選択肢間隔・音当ての音色ごとに保存する。発声の保存キーには到達猶予も含め、旧1秒ルールの記録とは分ける。保存不可でもゲームは継続する。単音練習の記録は独立して保持する。

## リズム練習

`rhythmPulseLevel()` が拍子と小節内の位置から強弱を返す。カウント音声と見本の打楽器は音量を、クリックは音量と音高を変える。実践編はピアノの各音とバスドラムに、実践編2は主旋律とキック、ロックのベースに強弱を適用する。7/8拍子では2＋2＋3の各グループの頭にアクセントを付ける。

`rhythmGamepad.ts` は Gamepad API の標準ボタン配置を練習と補正測定の描画フレームで読み、押し始めを入力として扱う。前回の読み取り以降のデバイス時刻を使い、取得できない場合は今回の読み取り時刻を使う。足の判定設定は初期状態でオフ。オンにすると本番の足あとごとに足の目標を作り、手と足で独立してタップと叩き忘れを割り当てる。両レーンの結果を合計し、既存の合格基準と進捗に適用する。

実践編2の原曲は `rhythmOriginalSongs.ts` に8小節単位のフレーズで定義する。リズム文字列、主旋律のMIDIノート番号、伴奏の和音を持ち、フレーズごとに主奏楽器、伴奏の奏法、ドラムのパターンを割り当てる。`rhythmArrangement.ts` が演奏データを組み立て、試聴と練習で共有する。練習中はドラムの隙間に足の拍を補う。7/8拍子では8分音符1つを1マスとして時刻を計算する。グループの先頭で足あとを大きくし、譜例と判定欄では区切り線を表示する。「七つの灯」のピアノの伴奏とフルートの応答もグループの先頭にそろえる。音は共有AudioContextで50ms間隔、最大200ms先まで予約する。レーンのマーカーは判定線に近いものだけDOMに置く。ピアノ・バイオリン・フルートとドラムは、再生区間の演奏データから必要な録音を選んで読み込む。ギター、ベース、シンセリード、メロトロン風の鍵盤は `generatedInstruments.ts` で再生前に必要な長さを合成し、楽器と音高ごとにバッファを再利用する。合成処理を短く区切り、準備中の描画や停止操作を受け付ける。ギターのチョーキングは譜面に半音数を持ち、発音後に再生速度を上げる。ロータム、クラッシュ、ライドの録音は `public/audio/rhythm/` に同梱する。進捗は曲全体の練習を完了したときに保存する。

`rhythmCourse.ts` に32ステップをまとめる。四分音符を拍の単位とする曲では1拍を2マス、三連符は3マス、16分音符を含むステップは4マスの文字列で表す。w・j・h・d・x・eは全音符・付点2分音符・2分音符・付点4分音符・4分音符・8分音符、t・f・zは三連符の8分音符・付点8分音符・16分音符の開始位置、rとsは4分休符と8分休符、ハイフンは音の保持や細分位置を表す。発音を始める位置だけを採点し、見本・レーン・判定表では音価に応じた形を描く。複数の固定例は順に並べ、混合では直前の小節を除く候補から抽選する。画面を開いた時点で出題する小節を選び、冒頭の音符と足あとを本番と同じ間隔で静止表示する。開始操作後、音源を準備している間はスピナーを表示する。読み込み後は同じAudioContextの時計で、無音の円形ゲージを3秒間表示し、曲と同じテンポで2小節分のカウントインを予約する。練習本番の音声カウントは数字の拍を読む。8分音符や裏拍を含むステップでクリックを選んだ場合は、拍の間にもクリックを追加する。

`rhythmScheduler.ts` は共有AudioContextを使い、50ms間隔で200ms先までカウントを予約する。ステップ選択の見本は、バスドラム、音符の頭で鳴るハイタム、任意のカウント音声を同じ時計へ予約する。実践編はハイタムに代えて、共通の `ReferencePlayer` でピアノ音源を鳴らす。デコード済みの音源は共通設定の試聴などと共有し、再生にはリズム練習側の音量を指定する。「きらきら星」はフランス民謡を4/4拍子で、「ふるさと」は岡野貞一作曲の旋律を3/4拍子で用い、それぞれ12小節と8小節を使う。「エリーゼのために」は原曲の3/8拍子を3/4拍子に置き換え、弱起を含む9小節。「美しく青きドナウ」は第1ワルツの冒頭8小節から装飾音を省いた単旋律。「運命」は冒頭のモチーフを一定テンポの8小節にまとめた単旋律。本番のピアノは採点時刻、バスドラムは足の拍と同じ時刻に予約する。実践編のカウント音は準備の2小節で鳴らす。 [洗足学園音楽大学掲載の「ふるさと」楽譜](https://www.senzoku.ac.jp/music/career/pdf/score1_furusato.pdf) [「エリーゼのために」の初版譜](https://commons.wikimedia.org/wiki/File:Beethoven_WoO_59_Erstausgabe.png) [交響曲第5番の初版パート譜](https://s9.imslp.org/files/imglnks/usimg/0/05/IMSLP46086-PMLP01586-Op.67.pdf) [ウィーン市立図書館の「美しく青きドナウ」初版譜](https://www.digital.wienbibliothek.at/wbrobv/content/titleinfo/2606471)

追加曲を含む全11曲の出典は `public/THIRD_PARTY_NOTICES.txt` に掲載する。配信する曲データは、保護期間が満了した歴史的な原曲の音高と発音位置を採譜したもの。譜例はアプリで描画し、音はCC0の楽器サンプルを使ってブラウザ内で生成する。「猫踏んじゃった」は作曲者と原曲の初出が確定できず、1954年の国内盤を確認できた範囲では海外配信での保護期間を判断しきれないため保留。 [昭和館のSPレコード情報](https://search.showakan.go.jp/search/record/detail.php?id=90007310) [文化庁の保護期間に関するQ&A](https://www.bunka.go.jp/seisaku/chosakuken/hokaisei/kantaiheiyo_chosakuken/1411890.html) [米国著作権局のURAA解説](https://copyright.gov/circs/circ38b.pdf)

バスドラムとハイタムにはVCSLのCC0録音を使い、取得に失敗した音は電子音で代用する。各小節の1拍目はバスドラムを強くする。出典、加工条件、チェックサムは `public/audio/rhythm/` に記録する。「通しで再生」では表示順に全見本をつなぎ、同じ時計で表示中の譜例をハイライトする。実践編2の譜例は冒頭4小節を表示する。見本の切り替え、譜例を閉じる操作、画面遷移で再生を停止する。補正測定のカウントダウンは、3つの電子音を同じ時計で予約する。最後の合図を高く長くし、カウント音の音量を適用する。カウント音声は男女各1組のWAVを使う。声が次の拍や本番の開始までに収まるよう、必要なときは再生速度を上げる。8分音符の見本では、半拍に収まるテンポで「&」も読み上げる。デコードに失敗した音や、1.4倍速でも収まらないカウントはクリックで鳴らす。生成条件とSHA-256は `public/audio/count/` に記録する。

合図を音に合わせる際は `getOutputTimestamp()` の時刻ペアで描画と入力を音の出力時刻へ合わせる。取得できない場合は `currentTime` と `performance.now()` による換算から `outputLatency`（未対応なら `baseLatency`）を引く。音に同期しない視覚ガイドでは `currentTime` を基準にする。採点時は選択したガイドの補正値を引く。 [Web Audio API仕様](https://www.w3.org/TR/webaudio-1.0/#dom-audiocontext-getoutputtimestamp)

`rhythmJudge.ts` は未判定で最も近い目標に±150ms以内のタップを割り当てる。±40ms以内はぴったり、±80ms以内はちょっとずれ、残りはミス。割り当て範囲外のタップは余分となり、150msを過ぎた未判定目標は叩き忘れとなる。本番開始の150ms手前から入力を受け付ける。割合の分母は目標音符と余分なタップの合計。第1章は「ぴったり」と「ちょっとずれ」の合計が85%以上で合格とする。第2〜5章は「ぴったり」60%以上かつミス10%以下で合格とする。平均とヒストグラムには音符に割り当てられたタップを使う。レーンは円形ゲージの表示中から描画し、最初の準備拍が右から判定線に入る。準備区間はグレーの背景、点線、輪郭の足あとで区別する。背景色の境目は本番の開始時刻を拍と同じ座標式で変換して描く。全小節の一覧は音符の位置に判定を残し、余分なタップは別に数える。

`rhythmCalibration.ts` は3秒のカウントダウン後に準備の4拍を表示し、続く8拍の各拍でタップを1回ずつ受け付けて中央値を採用する。未入力の拍があるか、標準偏差が60msを超える場合は再測定を求める。視覚と音の補正はそれぞれ測定・解除できる。初期設定では視覚ガイドを使い、補正値は測定するまで0msとする。`rhythmProgressStore.ts` は進捗、補正値、自由選択を含む設定を `rhythm-course:v1:` のlocalStorageへ保存する。第1〜4章は2連続合格、第5章は曲全体で1回合格するとステップをクリアする。自由選択で練習した記録も保存し、通常の選択では手前の全ステップをクリア済みか確認する。保存不可でも現在のページ内で練習を継続できる。ビュー切り替え、停止、非表示、ページ離脱では音と描画を止め、途中結果は記録しない。

## 音程検出

音程検出には `pitchy` の McLeod Pitch Method を使っている。`pitchy` は MIT ライセンスで配布され、ブラウザで `Float32Array` を直接扱えるため、Web Audio API のマイク入力と相性がよい。

現在の処理:

- `AnalyserNode.getFloatTimeDomainData()` で取得した波形を `pitchy` に渡す
- McLeod Pitch Method の検出結果と clarity を取得する
- 検出結果が目標音の上下1オクターブに入っているか確認する
- clarity と目標音からの近さを使って採否を決める
- 音量が小さい場合は検出しない

## 音源ファイル解析

音源ファイル解析の流れは `src/audioAnalysisPipeline.ts`、軽量推定と共通の結果集計は `src/audioFileAnalysis.ts` が扱う。メディアファイルから PCM データを取り出す処理は `src/mediaAudioExtraction.ts`、任意のボーカル抽出は `src/vocalSeparation.ts` に分離している。

WebGPUの利用可否とアダプタ取得、テンソルの解放、CREPE / RMVPEのセッション生成は `src/onnxRuntime.ts` を使う。Demucs と BS-RoFormer のステレオへのリサンプリングは `src/mediaAudioExtraction.ts` を共有し、モデルが必要とするサンプリングレートを渡す。モデルの前処理、セッションの再利用、分離モデルのセッション設定は各実装が扱う。

CREPEとRMVPEの出力は `src/pitchModelDecoding.ts` でデコードする。ピーク周辺の重み付き平均は、従来どおりCREPEではビン番号、RMVPEではセントで計算する。RMVPEとBS-RoFormerは `src/audioDsp.ts` のFFT・周期的ハン窓・反射パディングを使う。パッド幅が入力長以上の場合、RMVPEは反射を繰り返し、BS-RoFormerは1回分の反射の外側を左ではゼロ、右では入力の先頭値で埋める。

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

BS-RoFormer のローカル検証では、Dev Container 内で `bun run prepare:bs-roformer-webgpu` を実行して `public/models/` にローカルONNXを生成する。このスクリプトは `uv` で `.tmp/onnx-tools` に Python venv を作り、`scripts/requirements-bs-roformer-webgpu.txt` のハッシュ付き lock に従って `onnx` / `onnxconverter-common` / `numpy` などをインストールして変換する。lock は Dev Container の Python 3.11 / Linux x86_64 環境を前提にしているため、Dev Container も `linux/amd64` で起動する。

Demucs / ONNX Runtime Web の実行では SharedArrayBuffer が必要になる場合があるため、公開環境では Cross-Origin-Opener-Policy と Cross-Origin-Embedder-Policy のレスポンスヘッダが必要になる。Cloudflare Pages 向けには `public/_headers` を配置している。GitHub Pages ではこのヘッダを設定できないため、ボーカル抽出は動かない可能性がある。

ライセンス面では、Mediabunny と `@mediabunny/mp3-encoder` は MPL-2.0、MP3 エンコードで使う LAME は LGPL、demucs-web、ONNX Runtime Web、onnxcrepe、VoiceConversionWebUI の RMVPE モデルは MIT として扱う。RoFormer 系の実行コードと既定参照モデルも配布元の MIT 表記を前提に扱うが、BS-RoFormer は配布元が商用前の学習データ条件確認を推奨しているため、その注意をUI、ドキュメント、`public/THIRD_PARTY_NOTICES.txt` に残す。ONNX Runtime Web の依存に Apache-2.0、BSD-3-Clause、ISC のパッケージが含まれるため、`public/THIRD_PARTY_NOTICES.txt` に追記している。Workers Static Assets の単一ファイルサイズ上限を避けるため、ONNX Runtime Web の WASM ファイルはアプリに同梱せず jsDelivr から実行時に取得する。Demucs のボーカル抽出モデルもアプリに同梱せず、既定では Hugging Face 上の `timcsy/demucs-web-onnx` の `htdemucs_embedded.onnx` を実行時に取得する。BS-RoFormer は開発時に `public/models/bs-roformer-fp16-webgpu.onnx` を生成して使い、公開ビルドでは `VITE_BS_ROFORMER_FP16_MODEL_URL` で配信用 URL を指定した場合のみ有効にする。CREPE 推定モデルは GitHub Releases 直リンクがブラウザの CORS 制約に当たりやすいため、アプリ実行時は `models/crepe-small.onnx`、`models/crepe-medium.onnx`、`models/crepe-large.onnx`、`models/crepe-full.onnx` を参照する。RMVPE モデルも `models/rmvpe.onnx` を参照する。これらは GitHub Pages のサブパス配信でも解決できるように相対URLにしている。ONNX モデルは Git リポジトリにはコミットせず、ローカルでは `bun run download:pitch-models`、GitHub Pages デプロイでは GitHub Actions の `Download pitch models for GitHub Pages` ステップで `public/models/` に取得してから build する。ランタイムで別モデルを使う場合は `VITE_RMVPE_MODEL_URL`、`VITE_DEMUCS_MODEL_URL`、`VITE_BS_ROFORMER_FP16_MODEL_URL` を使う。`VITE_CREPE_MODEL_URL` は現状 CREPE small の差し替えにのみ使い、ダウンロード元の差し替えは `CREPE_SMALL_MODEL_SOURCE_URL` など size 別の環境変数を使う。

音源グラフは、短いフレームごとの検出点を薄い点群で表示し、近傍中央値から作った中心線を重ねる。ピッチ検出は子音、息、リバーブ、分離ノイズで瞬間的に乱れるため、全点を連続線で結ばない。再生位置の縦線、時刻、音名はCanvasに重ねたDOMで表示し、長いグラフでは現在位置が見えるようにスクロールする。Canvasのサイズの計測は表示・音源・レイアウトの変更時に行い、描画範囲や解析結果が変わったときに背景グラフと中心線を描き直す。

開発サーバの `/model-comparison.html` で、ピッチ推定モデル比較PNGと全ボーカル抽出モデルMP3を出力できる。比較ページは通常の公開ビルドの入口から独立している。`src/modelComparisonTool.ts` が解析パイプラインとグラフ描画を呼び出し、PNGでは各推定器の結果を縦に並べる。必要に応じて `bun run download:pitch-models` で比較用モデルを取得する。MP3比較は各モデルの失敗を記録して次のモデルへ進む。BS-RoFormerを比較する場合は `bun run prepare:bs-roformer-webgpu` でローカルモデルを生成する。

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

## PWA

`public/manifest.webmanifest`と192px・512px・maskableのアイコンを配信する。アイコンは既存の`assets/originals/app-icon.png`をImageMagickで縮小し、maskable版には余白を付ける。`src/pwa.ts`は本番ビルドでのみService Workerを登録し、インストール対応ブラウザでボタンを出す。非対応ブラウザではメニューによる追加を案内する。

Viteの`buildServiceWorker()`が書き出し済みのHTML・JS・CSS・画面内画像・ライセンス文書からプリキャッシュ一覧と内容ハッシュを作り、`scripts/service-worker.js`から`sw.js`を生成する。最終HTMLの内容もハッシュに含める。JSは古い画面から遅延チャンクを参照できるよう全チャンクを保持する。ハッシュ付きJS/CSSはHTTPキャッシュを再利用し、インストール用アイコンはプリキャッシュ対象にしない。モデル、WASM、外部リクエスト、音声入力は対象外。

URLとキャッシュ名はService Workerのscope基準とする。アプリシェルはscope直下と`index.html`へのナビゲーションにだけ返し、`THIRD_PARTY_NOTICES.txt`はオフラインでも原文を返す。録音WAVは利用時に、WAV素材の内容ハッシュを使った別キャッシュへ保存する。アプリ本体の更新では保持し、音源素材が変わったときだけ更新する。activateでは同じscopeの現行シェルと現行音源キャッシュを残し、旧版だけを削除する。

更新は既存ウィンドウが閉じるまで待ち、`skipWaiting()`による強制更新はしない。オフライン利用はキャッシュ準備後に限り、ブラウザの保存領域の削除・制限の影響を受ける。Chromiumの合成音入力、オフライン起動、更新待機、サブパス配信とインストール要件の検査で確認し、実声・iOS実機・OSのホーム画面へのインストールは未検証。

## 自分の声域チェック

`src/voiceRangeCheck.ts`が独立したAudioContextを持ち、`MicrophoneInput`を8192サンプルで起動する。検出は共有入力の `sampleVoiceRange()` からpitchyを使い、共通設定のマイクと感度を適用する。目標音に依存する練習用の候補選択は使わない。検出対象は約32.7〜2100Hz、表示対象はMIDI24〜96（C1〜C7）、clarityは0.93以上とする。`src/voiceRange.ts`は同じ半音の音を600ms保持した場合に記録する。この保持時間は使い勝手を評価するための暫定値で、実声や文献で妥当性を確認した閾値ではない。無音・音の変化・150ms超の観測間隔では保持をリセットする。持続したオクターブ誤検出は完全には除けないため画面で説明する。結果は実際に記録した各音とその両端を示し、区間内の全音の確認や地声・裏声の識別は行わない。

3表記の変換は`src/pitchMath.ts`にまとめる。ドレミ表記には国際式と同じオクターブ番号を付ける。カラオケ式はA4＝hiAのA境界方式とする（参考：[岡部洋一『音階』2.2 オクターブ表記](https://www.moge.org/okabe/temp/scale.pdf)）。停止・画面切り替え・非表示・pagehide・設定変更でマイクと予約中の開始要求を解放し、許可の遅延応答による再接続を防ぐ。結果はページ内のメモリにだけ保持する。停止後に各音を個別削除でき、その音が両端だった場合は結果と破線を更新する。生の声の軌跡は削除しない。状態メッセージは200ms継続した状態を表示し、検出の揺れによる頻繁な読み上げを抑える。

声域チェックの描画は`src/voiceRangeGraph.ts`、表示範囲と座標は`src/graphModel.ts`の`createVoiceRangeGraphLayout()`に分離する。声の軌跡は約25Hz以下で直近12秒分だけ保持し、半音に丸める前の検出値を描く。縦軸は直近の検出音と全記録の両端を含む範囲（最小1オクターブ）とし、記録済みの最低・最高を破線で示す。無音・検出不能・250ms超の間隔・停止をまたいで線をつながない。停止時は時間軸を固定して保持し、記録の消去で軌跡も初期化する。ResizeObserverと既存のCanvas解像度計算で画面幅とピクセル比に追従する。
