# 週間計画対話改善のCodexレビュー指摘を修正する

Status: open
Created: 2026-07-16
Parent: `20260716-weekly-planning-conversation-hardening.md`

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

- [ ] BLOCKER 4件を再現テスト付きで解消する
- [ ] MAJOR 4件を解消する
- [ ] MINOR指摘を解消する
- [ ] 全テストとproduction buildを通す
- [ ] Codex再レビュー用mdを更新する
