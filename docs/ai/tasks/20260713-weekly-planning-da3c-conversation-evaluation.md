# DA3c: mentor conversation evaluation

Status: **queued — DA3a/DA3b after**
Priority: Medium
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-EVAL-001, DA-GOAL-001, DA-FALLBACK-001

## 背景・目的

会話品質を golden text で測らず、contract/state/fact と mentor rubric、call/latency/fallback metrics で再現可能に評価する。既存 roleplay の happy path 偏重を解消する。

## 計画書との対応・対象

- spec: §1、§5、§12、§13
- 変更: docs/testing/weekly-planning-roleplay-test-plan.md、fixtures/runner、metrics
- テスト: P1-P7、contract/property/integration/roleplay/real-model

## 現在の処理経路・問題

既存対話は action/state/factRef、async stale、security、migration、approval、fallback の traceability が不足し、再質問・内部 slot・根拠なし数値・追加 call を見逃す。

## 修正方針・契約

P1 novice、P2 keyboard、P3 malicious、P4 integrity、P5 migration、P6 regression、P7 traceability を test layers に割り当てる。strict assertion は action/factRef/field/state/stateRevision/requestId/turnId/proposal/correction/topic/option/preview/stale/fallback/call count/duplicate/accepted/rejected/diagnostics。自然文 rubric は敬体、簡潔、再質問なし、無関係な一括質問なし、内部 slot 非表示、仮定/事実区別、根拠なし値なし、次入力明確、mentor options、入力無視なし。

## 失敗・concurrency・security・persistence

fixture/model output は redacted JSON、secret/user string を prompt 命令に連結しない。test run の conversation/turn/request/revision を固定し、遅延 stale を拒否する。metrics/fixtures は versioned、会話 state は自動保存しない。provider failure は no extra call/no merge を strict にする。

## 受け入れ条件

1. P1-P7 matrix と P7 traceability table。2. contract/property/integration/roleplay/real-model の二層採点。3. opening/normal call budget、token、p50/p95 latency、fallback/reject/completion metrics。4. golden exact match なし。5. DA-EVAL-001 と全 v4 IDs が追跡可能。

## テスト・リスク

P1/P2 input and focus、P3 hostile/AI side effect、P4 partial approval、P5 corrupt/emoji/user-week、P6 provider/exam/non-exam/fallback、P7 table を実行。モデル更新で wording が変わるため行為/事実を strict、自然文を rubric に分離する。

## Codexへの実装指示

対象限定、docs/ai/codex-task-guide.md 準拠。real model は redacted corpus、fixed budget、低温度、fallback を記録し、test/build/diff check/status を報告する。git add/commit/push/reset/restore/checkout/stash は行わない。

