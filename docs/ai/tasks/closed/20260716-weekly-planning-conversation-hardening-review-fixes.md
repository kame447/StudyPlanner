# 週間計画対話改善のCodexレビュー指摘を修正する

Status: closed / completed
Created: 2026-07-16
Closed: 2026-07-17
Parent: `20260716-weekly-planning-conversation-hardening.md`
Outcome: 初回レビュー指摘を実装し、後続再レビューを経てPR #5へ統合した。

## 目的

PR #5の初回Codexレビューで確認されたBLOCKER、MAJOR、MINORを、既存機能を壊さず一般化された責務として修正する。

## 実装順

1. exam scope属性単位mergeとpriority provenance
2. command unionの閉じたruntime validation
3. fixed event occurrenceの共通抽出と全対話経路のgrounding
4. session-owned async turnとapproval lock
5. modal再開、storage version、controller契約
6. 全テスト・build・再レビュー

## 完了条件

- [x] BLOCKER 4件を再現テスト付きで解消する
- [x] MAJOR 4件を解消する
- [x] MINOR指摘を解消する
- [x] 全テストとproduction buildを通す
- [x] Codex再レビュー用mdを更新する

## 履歴上の扱い

この文書の完了後も複数回の再レビュー修正が行われた。最終状態はPR #5 merge commit `55f8e32`と`docs/ai/weekly-planning-pr5-post-merge-status.md`を参照する。
