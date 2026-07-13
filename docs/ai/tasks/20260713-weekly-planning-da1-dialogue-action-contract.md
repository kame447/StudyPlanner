# DA1: DialogueStateSnapshot と action/response contract

Status: **queued — DA0 after**
Priority: High
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-ACTION-001, DA-RESPONSE-001, DA-FALLBACK-001

## 背景・目的

v4 planner の action、factRef、question topic、response part の allow-list と fact-grounded rendering が不足している。snapshot/allowed actions/response validator/fallback を pure contract として固定する。

## 計画書との対応・対象

- spec: §12、§13
- 変更: dialogue snapshot/action/response types、allow-list validator、fallback
- テスト: unit/contract/integration、P3/P6/P7

## 現在の処理経路・問題

userText → interpreter → normalize/validate → reducer → scheduler/preview の結果を planner に渡す public fact が定義されず、unknown/private/stale ref、未許可 topic/option、根拠なし preview を防げない。

## 修正方針・型契約

DialogueStateSnapshot は conversationId、stateRevision、acceptedFacts、rejectedCommands、pendingAssumptionProposals、correctionHistory、planningRange、existingEvents、feasibility、preview、allowedQuestionTopics、上限付き recentHistory を持つ。AllowedDialogueActions は deterministic に導出する。

DialogueResponsePart は text/fact/question/option、DialogueResponsePlan は action、factRefs、questionTopics、responseParts、assumptionProposal、previewOffer。text は接続語のみ、日時/分数/件数/タイトル/範囲は fact part。action、field、factRef、topic、option、preview、revision を allow-list で検証し、invalid は全体 reject、response 再パースなし。

## 失敗・concurrency・security・persistence

provider unavailable/exception/timeout/parse/schema/unknown ref/action/field/unauthorized/stale は deterministic fallback、追加 AI call と rules/AI merge なし。active request 一件、turn/request/revision mismatch は無効。全 user string は untrusted JSON、escaped rendering。contract は session-local、将来 schemaVersion/migration hook のみ。UI/CSS、scheduler全面改造、save/approval、無関係 src は触らない。

## 受け入れ条件

1. snapshot/action/fact allow-list が deterministic。2. unknown/private/stale ref、field、topic、option、preview を reject。3. invalid output は partial apply せず fallback。4. accepted/rejected/pending と preview stale を保持。5. normal/opening call budget を超えない。6. AI state/save/repo action を許さない。

## P1-P7・テスト・リスク

P1 空入力/double submit/stale、P2 Enter/Shift+Enter/IME/focus、P3 hostile output/injection/side effect、P4 stale preview、P5 schema/migration、P6 fallback/exam/non-exam、P7 DA-ACTION-001/DA-RESPONSE-001/DA-FALLBACK-001 traceability。unit/contract/integration/property/roleplay を行い、golden text 完全一致なし。既存 renderer の自由 text と競合しうるため fallback fact を失わない。

## Codexへの実装指示

対象限定、docs/ai/codex-task-guide.md 準拠。test/build/diff check/status を報告し、git add/commit/push/reset/restore/checkout/stash は行わない。

