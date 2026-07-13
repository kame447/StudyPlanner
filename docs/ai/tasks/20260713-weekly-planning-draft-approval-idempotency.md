# Draft approval idempotency: preview から deterministic save へ

Status: **queued — DA1/DA1b after**
Priority: High
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-IDEMPOTENCY-001, DA-PERSISTENCE-001, DA-PREVIEW-001

## 背景・目的

preview approval/save は AI dialogue と別の副作用だが、duplicate click、partial failure、crash retry、source metadata の契約が不足している。approval operation を user/source/revision に束縛し、再試行で重複予定を作らない。

## 計画書との対応・対象

- spec: §10、§12、§13
- 変更: preview/repository adapter、approval operation、UI failure handling
- テスト: repository fake、failure injection、P4/P5/P6

## 現在の処理経路・問題

preview → UI approve → repository save の間に operation ledger と idempotency key がなく、stale preview/他 user/week/途中失敗を安全に区別できない。

## 修正方針・契約

WeeklyDraftApprovalOperation は approvalOperationId、userId、sourceDraftBlockIds、startedAt、status=pending|partially_saved|completed|failed。ApprovedPlanSource は sourceType=weekly_draft、sourceDraftBlockId、approvalOperationId。userId + sourceDraftBlockId + approvalOperationId を重複キーにする。completed retry は no-op、partial retry は未保存分のみ、stale/revision mismatch/unauthorized は拒否。AI は operation を起動しない。

状態、schema/enum/size/user/week/revision を deterministic に検証し、UI/repository 失敗順序、optimistic rollback、source metadata を記録する。

## 失敗・concurrency・security

同一 user の active operation を一件にし、二重 click/request は dedupe。crash 後 retry は ledger から再開し、別 user/source は拒否。draft title/memo は untrusted JSON data とし、action/ref/ID に昇格させない。provider fallback は approval を開始しない。

## persistence・migration / 触らない範囲

operation ledger/source metadata の schemaVersion/migration を versioned/idempotent にする。破損/未知/上限超過は安全に破棄。会話/request は復元しない。scheduler、interpreter、AI planner、CSS、無関係 src、auto-save、git write は触らない。

## 受け入れ条件

1. duplicate/crash/partial retry で重複予定なし。2. source/user/operation ID が保存に付く。3. stale/unauthorized save を拒否。4. UI/repository failure の rollback/retry 順序を検証。5. 明示 approve のみで保存。

## P1-P7・テスト・リスク

P1 double click/disabled、P2 keyboard submit、P3 forged IDs/stale preview、P4 partial save/idempotency、P5 migration/F5、P6 save/discard/fallback、P7 DA-IDEMPOTENCY-001/DA-PERSISTENCE-001/DA-PREVIEW-001。unit/contract/integration/property を実施し real model は不要。既存 repository API 互換性がリスク。

## Codexへの実装指示

対象を限定し、docs/ai/codex-task-guide.md に従う。npm test/build、diff check、status を報告し、git add/commit/push/reset/restore/checkout/stash は行わない。

