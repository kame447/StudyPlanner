# DA3b: feasibility consultation

Status: **queued — DA3a after**
Priority: Medium
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-FEASIBILITY-001, DA-GOAL-001

## 背景・目的

capacity不足、unscheduled、priority、分割方針を scheduler の計算根拠で相談する dialogue contract が不足している。AI が容量や配置を独自計算せず、許可された options だけを提示する。

## 計画書との対応・対象

- spec: §2、§5、§6、§12、§13
- 変更: feasibility snapshot/options adapter、dialogue planner contract
- テスト: capacity fixtures、P1/P3/P6/P7

## 現在の処理経路・問題

scheduler は required/available/scheduled/unscheduled/conflicts を計算するが、public fact refs/options と preview eligibility が定義されていない。

## 修正方針・契約

diagnostics を snapshot にし、blocking/assumable/deferrable を deterministic に分類する。option IDs は deterministic issuer。keep priority/split/defer/ask user 等の allow-list のみを planner に渡し、feasibility fact と preview candidate がない offer を拒否する。

## 失敗・concurrency・security

capacity/placement を AI が変更しない。stale snapshot、unknown option/ref、untrusted title/memo、NaN/negative duration、provider failure は partial apply せず deterministic fallback。active request は一件、追加 AI call なし。

## persistence・migration / 触らない範囲

diagnostic は session-local、draft block localStorage の既存契約だけ維持。approval は別 task。scheduler 全面改造、save/delete、UI/CSS、無関係 src、git write は触らない。

## 受け入れ条件・P1-P7

capacity mismatch、unscheduled、priority option、no-reask、preview gating、fallback、existing schedule coexistence を strict に検証。P1 novice、P2 keyboard、P3 forged options、P4 stale preview、P5 migration/F5、P6 provider/exam/non-exam、P7 DA-FEASIBILITY-001/DA-GOAL-001。unit/contract/integration/property と rubric、real model は DA3c。

## Codexへの実装指示

対象を限定し、docs/ai/codex-task-guide.md に従う。npm test/build、diff check、status を報告し、git add/commit/push/reset/restore/checkout/stash は行わない。

