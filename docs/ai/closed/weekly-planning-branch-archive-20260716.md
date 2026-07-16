# 週間計画ブランチ整理記録

Status: active record
Date: 2026-07-16

## 目的

週間計画関連の完了済みブランチを削除しても、PR、commit SHA、統合先を後から追跡できるようにする。

## 削除してよいブランチ

| branch | related PR / record | reason |
| --- | --- | --- |
| `agent/clarification-cleanup-run` | PR #4 | close済みの一時検証branch |
| `agent/clarification-fix-validation-base` | PR #4 base | 一時検証用base branch |
| `agent/weekly-planning-trace-full-implementation` | PR #2 | `main`へmerge済み |
| `feat/weekly-planning-conversation-trace` | PR #1 | `main`へmerge済み |
| `feat/weekly-planning-dialogue-stack-completion` | completion record | head commitが`main`の祖先 |
| `feat/weekly-planning-behavior-aware-dialogue` | completion record | head commitが`main`の祖先 |
| `audit/weekly-planning-da0a` | audit record | head commitが`main`の祖先 |
| `feat/weekly-planning-draft-mvp` | historical implementation branch | head commitが`main`の祖先 |

## 現時点で保持するブランチ

| branch | reason |
| --- | --- |
| `main` | default branch |
| `agent/weekly-planning-conversation-hardening` | PR #5 open / draft / not merged |
| `docs/weekly-planning-md-cleanup-20260716-history` | Markdown整理15 commitの唯一の残存branch。元の`docs/weekly-planning-md-cleanup-20260716`は存在しない |
| `docs/weekly-planning-personalization-design` | main未統合の設計文書・task 7 commitを保持 |
| `audit/weekly-planning-p4` | main未統合の実装・test 5 commitを保持 |

## 既に存在しないブランチ

- `agent/fix-weekly-planning-dialogue-path` — PR #3でmerge済み。監査時点でbranch refは存在しなかった。
- `docs/weekly-planning-md-cleanup-20260716` — 元のMarkdown整理branch。現在は`docs/weekly-planning-md-cleanup-20260716-history`だけが同変更を保持する。

## 履歴保持方針

- merge済みbranchを削除しても、mainから到達できるcommit、merge commit、PR本文、コメント、レビュー、changed filesは残る。
- temporary validation branchは、PR番号とhead/base SHAを本記録へ残した後で削除する。
- main未統合commitを持つbranchは、mergeまたは別branchへ退避するまで削除しない。
- branch削除後は、branch名ではなくPR番号、completion record、commit SHAから履歴を参照する。
