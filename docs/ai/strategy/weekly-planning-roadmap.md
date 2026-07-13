# 週間計画 AI ロードマップ

Status: **v4 audit-normalized**
最終更新: 2026-07-13
DoR: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Product goal: ../../weekly-planning/weekly-planning-spec.md

## Current queue（同時に一件だけ open）

1. Gate P4 — verification gate。既存差分を P4 受入条件で検証するだけで、closed/adopted/migration complete とは宣言しない。
2. **DA0 — open**。non-exam StudyTaskScope → duration/quantity → PendingAssumptionProposal → GenericWeeklyWorkItem → candidates → preview。
3. DA1 — queued。DialogueStateSnapshot、action/response/fact-grounding contract。
4. DA1b — queued。assumption lifecycle と correction/overwrite/remove/supersede/restore。
5. Draft approval idempotency — queued。operation、partial failure、retry、source metadata。
6. DA2 — queued。state-grounded orchestrator、turn envelope、cancel/stale、二段階 call。
7. DA3a — queued。relative constraint domain。
8. DA3b — queued。feasibility consultation。
9. DA3c — queued。P1-P7 conversation evaluation、metrics、real-model evaluation。

DA0 完了後に DA1 を open にし、各 acceptance/verification 完了まで次を open にしない。旧 D1/D2/D3、P5〜P9、T6 は historical/superseded で current queue ではない。

## 責務境界

single AI interpreter は typed candidates のみ。normalize、validate、adapter、reducer、fact/ID/revision、accepted/rejected/pending、scheduler、availability、capacity、preview、approval/save/delete は deterministic。dialogue planner は snapshot と allow-list 内で action/factRefs/questionTopics/assumption/preview/response plan を選ぶ。全 user-originated string は untrusted JSON data。provider failure は turn-wide fallback、追加 AI call と rules/AI merge なし。empty candidates は provider failure ではない。

## 監査で統合した決定

non-exam bridge、assumption/correction lifecycle、response fact allow-list、turn/request stale、approval idempotency、session-local/migration、P1-P7 traceability を v4 task に割り当てた。P7 table の要件 ID が task、test layer、strict assertion、rubric、status の正である。