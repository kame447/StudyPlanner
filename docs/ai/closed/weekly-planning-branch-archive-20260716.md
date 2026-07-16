# 週間計画ブランチ整理記録

Status: deletion pending
Date: 2026-07-16

## 目的

週間計画関連の完了済みブランチを削除しても、PR、commit SHA、統合先を後から追跡できるようにする。

## 削除対象として確認した既存ブランチ

| branch | final SHA | related PR / record | status |
| --- | --- | --- | --- |
| `feat/weekly-planning-conversation-trace` | `688266ecbe00374d266e324769fa104e46b08e8e` | PR #1 | merged into `main` |
| `agent/weekly-planning-trace-full-implementation` | `ce96dd0944cbde07162b245ae3c8b76443904407` | PR #2 | merged into `main` |
| `agent/fix-weekly-planning-dialogue-path` | `f923810140fca63921e749816165ef472f6f2e19` | PR #3 | merged; already absent at audit time |
| `agent/clarification-cleanup-run` | `d8a81a3cfd6a239c67a1a48d95ff6ab02a99a1d4` | PR #4 | temporary validation branch; PR closed |
| `agent/clarification-fix-validation-base` | `3636f9dded7e96efafcbc68b65da15100bb9cd15` | PR #4 base | temporary validation base |
| `feat/weekly-planning-behavior-aware-dialogue` | `1c6ad4a31e8102ffc6144eb42e7f0152b5498936` | behavior-aware completion record | commit is an ancestor of `main` |
| `feat/weekly-planning-dialogue-stack-completion` | `00969de194a2f3c7c61a57c94a2ea72ce6ef6eec` | dialogue stack completion record | commit is an ancestor of `main` |

## ChatGPTが誤って作成した削除対象ブランチ

次の3本は、削除APIの有無を確認する過程で誤って作成した。いずれも独自の実装変更は持たず、削除してよい。

- `archive/branch-history-20260716`
- `docs/weekly-planning-md-cleanup-20260716-history`
- `docs/weekly-planning-md-cleanup-20260716-final`

## 保持するブランチ

- `main`
- `agent/weekly-planning-conversation-hardening` — PR #5がopen / draft / not merged
- `docs/weekly-planning-md-cleanup-20260716` — Markdown整理が未マージ

## 履歴保持方針

- merged branchを削除しても、mainから到達できるcommit、merge commit、PR本文、コメント、レビュー、changed filesは残る。
- temporary validation branchは、PR番号とhead/base SHAを本記録へ残した後で削除する。
- branch削除後は、branch名ではなくPR番号、completion record、commit SHAから履歴を参照する。

## 実行上の注記

2026-07-16時点のChatGPT GitHub connectorにはGit ref削除操作が提供されていないため、remote branchの削除はGitHub UIまたは認証済みgit環境から実行する必要がある。
