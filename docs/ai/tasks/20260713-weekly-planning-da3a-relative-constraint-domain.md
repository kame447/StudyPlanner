# DA3a: relative constraint domain

Status: **queued — DA2 after**
Priority: Medium
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-RELATIVE-001

## 背景・目的

「授業後に移動10分」のような相対条件は意味解釈と deterministic busy interval 展開の境界が未定義である。typed relation を導入し、AI の直接 placement、cycle/self relation を禁止する。

## 計画書との対応・対象

- spec: §4、§9、§12、§13
- 変更: intake relative constraint types/adapter、constraint resolver
- テスト: property/fuzz、P3/P6

## 現在の処理経路・問題

interpreter が relation 候補を出しても adapter/scheduler は absolute time を正とし、anchor、offset、revision、cycle の検証契約がない。

## 修正方針・契約

anchor event/fact ref、before/after、offset、confidence、sourceFactRefs、stateRevision を typed domain にする。authorized anchor と finite/range offset だけを受理し、resolver が absolute interval/busy interval へ展開する。cycle/self/ambiguous は reject/clarification。scheduler が最終時刻、衝突、容量を計算する。

## 失敗・concurrency・security

stale revision/source mismatch、unknown/private anchor、NaN/Infinity/負/過大 offset、circular/self は partial apply せず fallback/clarification。source text/title は untrusted JSON data。active request、request/turn mismatch、rules/AI merge、追加 AI call を禁止する。

## persistence・migration / 触らない範囲

relative relation は draft/session-local。将来 schemaVersion migration の枠だけ設ける。scheduler 全面改造、approval/save、UI/CSS、complex recurrence、無関係 src、git write は触らない。

## 受け入れ条件・P1-P7

typed relation、absolute expansion、cycle/self/ambiguous rejection、existing schedule coexistence、preview stale を strict に検証する。P1 input、P2 IME、P3 hostile relations、P4 stale preview、P5 migration、P6 fallback/exam、P7 DA-RELATIVE-001 traceability。unit/contract/integration/property を行い、real model は fixture replay のみ。

## Codexへの実装指示

対象を限定し、docs/ai/codex-task-guide.md に従う。npm test/build、diff check、status を報告し、git add/commit/push/reset/restore/checkout/stash は行わない。

