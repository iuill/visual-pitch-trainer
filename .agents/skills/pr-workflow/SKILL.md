---
name: pr-workflow
description: このリポジトリ向けのプルリクエストワークフロー。Codex が GitHub プルリクエストの作成、更新、レビュー可能状態への変更、マージ、後片付けを求められたときに使用する。PR 作成後はレビュー可能な状態にし、マージはマージコミットを使い、マージ済みの作業ブランチはローカルとリモートの両方から削除する。
---

# PR ワークフロー

## 概要

このリポジトリで GitHub プルリクエストを操作するときは、このスキルを使用する。PR のライフサイクルを明確に扱うこと。PR はレビュー可能な状態で作成し、マージコミットでマージし、マージ後は作業ブランチをローカル Git とリモートの両方から削除する。

## PR 操作の前に

- ユーザーが明示的に別の方法を求めない限り、GitHub 操作には `gh` を使う。
- 何かを変更する前に、現在のブランチ、ワークツリーの状態、PR の状態を確認する。

```sh
git branch --show-current
git status --short
gh pr status
```

- 関係のないユーザー変更を上書きしたり破棄したりしない。
- デフォルトブランチから PR を作成またはマージしない。
- ユーザーが別の指定をしない限り、PR タイトルと本文は日本語を優先する。

## PR を作成する

1. コードまたはドキュメントを変更した場合は、公開前にリポジトリの関連する検証を実行する。通常のコード変更では次を使う。

```sh
bun run lint
bun run test
bun run typecheck
bun run build
```

2. 現在の作業ブランチをプッシュする。

```sh
git push -u origin HEAD
```

3. `--draft` を付けずに PR を作成する。PR タイトルと本文は、変更内容に合わせて日本語で明示する。コミットメッセージから自動生成される `--fill` は、タイトルや本文が英語になったり、現在の差分とずれたりする可能性があるため既定では使わない。本文ファイルはリポジトリ内に残さず、一時ファイルを使う。

```sh
gh pr create --title "日本語のPRタイトル" --body-file /tmp/pr-body.md
```

4. PR が下書きではないことをすぐに確認する。何らかの理由で下書きになっている場合はレビュー可能な状態にする。

```sh
gh pr view --json number,isDraft
```

PR が下書きの場合にのみ、次を実行する。

```sh
gh pr ready PR_NUMBER
```

## PR をマージする

1. 作業ブランチを記録し、マージ後に削除して安全であることを確認する。

```sh
git status --short
gh pr view --json number,headRefName,baseRefName,mergeStateStatus,isDraft
```

2. PR が下書きの場合、チェックが未解決の場合、対象ブランチが不明確な場合、またはワークツリーに後片付けを曖昧にする関係のない変更がある場合は、マージしない。
3. マージ前に CI とレビューの状態を確認する。

```sh
gh pr view PR_NUMBER --json statusCheckRollup,reviews,reviewDecision
```

必要に応じて、最新プッシュの CI 完了を `gh run watch` で確認する。CI 後にボットレビューが届く可能性がある場合は、マージ前に概要レビューとインラインレビューコメントの両方を再確認する。

4. 追加コミットによって変更範囲が広がった場合は、PR タイトルと本文が現在の差分とまだ一致しているか確認する。古くなっている場合はマージ前に更新する。
5. ローカルの作業ブランチをきれいに削除できるように、マージ前にベースブランチへ切り替える。

```sh
git switch BASE_BRANCH
git pull --ff-only
```

6. マージコミットでマージし、ブランチ削除を有効にする。ユーザーがこのリポジトリルールを明示的に上書きしない限り、スカッシュマージやリベースマージは使わない。

```sh
gh pr merge PR_NUMBER --merge --delete-branch
```

7. マージ後、ローカルとリモートの両方でブランチ削除を確認する。ローカルブランチが残っている場合は手動で削除し、リモートブランチが残っている場合も手動で削除する。

```sh
git fetch --prune
git branch --list WORK_BRANCH
git ls-remote --heads origin WORK_BRANCH
```

ローカルブランチが残っている場合にのみ、次を実行する。

```sh
git branch -d WORK_BRANCH
```

リモートブランチが残っている場合にのみ、次を実行する。

```sh
git push origin --delete WORK_BRANCH
```

8. 最後はベースブランチ上で最新のリモート状態にし、ワークツリーを確認する。

```sh
git pull --ff-only
git branch --show-current
git status --short
```

9. 最終報告には、マージした PR 番号、利用できる場合はマージコミット、ローカルとリモートの作業ブランチを削除した確認を含める。
