# 週間計画ブランチ整理記録

Status: completed cleanup record
Date: 2026-07-16

## 目的

週間計画関連の完了済みブランチを削除しても、PR、commit SHA、統合先を後から追跡できるようにする。

## 削除完了を確認したブランチ

ユーザーが2026-07-16にGitHub UIから削除した。

| branch | related PR / record | history location |
| --- | --- | --- |
| `agent/clarification-cleanup-run` | PR #4 | closed PR #4 |
| `agent/clarification-fix-validation-base` | PR #4 base | closed PR #4 |
| `agent/weekly-planning-trace-full-implementation` | PR #2 | merged PR #2 / main history |
| `feat/weekly-planning-conversation-trace` | PR #1 | merged PR #1 / main history |
| `feat/weekly-planning-dialogue-stack-completion` | completion record | main history / dialogue stack completion |
| `feat/weekly-planning-behavior-aware-dialogue` | completion record | main history / behavior-aware completion |
| `audit/weekly-planning-da0a` | audit record | main history |
| `feat/weekly-planning-draft-mvp` | historical implementation | main history |

## Markdown整理ブランチ

`docs/weekly-planning-md-cleanup-20260716-history`はPR #6で`main`へmerge済みである。

- PR: #6 `docs: 週間計画Markdownを整理`
- merge commit: `8992d80cb41a43b58957502e20bad6d77b3ce053`
- merge method: merge commit
- 個別commit履歴: `main`から到達可能

このbranchは削除しても履歴を失わない。branch refの削除完了自体は本記録では確認していない。

## 現時点で保持するブランチ

| branch | reason |
| --- | --- |
| `main` | default branch |
| `agent/weekly-planning-conversation-hardening` | PR #5 open / draft / not merged |
| `docs/weekly-planning-personalization-design` | main未統合の設計文書・taskを保持 |
| `audit/weekly-planning-p4` | main未統合の実装・testを保持 |

## 既に存在しなかったブランチ

- `agent/fix-weekly-planning-dialogue-path` — PR #3でmerge済み。監査時点でbranch refは存在しなかった。
- `docs/weekly-planning-md-cleanup-20260716` — 元のMarkdown整理branch。PR #6では残存していた`-history` branchを使用した。

## 履歴保持方針

- merge済みbranchを削除しても、mainから到達できるcommit、merge commit、PR本文、コメント、レビュー、changed filesは残る。
- temporary validation branchは、PR番号とhead/base SHAを記録した後で削除する。
- main未統合commitを持つbranchは、mergeまたは別branchへ退避するまで削除しない。
- branch削除後は、branch名ではなくPR番号、completion record、commit SHAから履歴を参照する。
