# DA1b: assumption proposal と correction lifecycle

Status: **queued — DA1 after**
Priority: High
Parent: docs/architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-ASSUMPTION-001, DA-CORRECTION-001

## 背景・目的

仮定の pending/accepted/rejected/superseded/expired と訂正・上書き・削除・復元の監査履歴が欠けている。proposal/correction を stateRevision と source facts に束縛し、暗黙 hard apply、復活、部分適用を禁止する。

## 計画書との対応

- spec: §5、§6、§10、§12、§13
- 改善テーマ: 七視点監査の assumption/correction lifecycle

## 対象ファイル

- 変更: intake types/adapter/reducer、dialogue contract
- 新規: proposal/correction validator と diagnostics
- テスト: lifecycle unit、atomic integration、property、P3/P6

## 現在の処理経路・問題

userText → interpreter candidate → normalize/validate → adapter → reducer には confirmed/pending guard があるが、proposal/correction の独立 lifecycle、target ambiguity、preview stale の再計算が未定義である。

## 修正方針・契約

AssumptionProposalStatus は pending|accepted|rejected|superseded|expired。PendingAssumptionProposal は proposalId、slot、targetRef、proposedValue/unit、reason、source、sourceFactRefs、createdAtTurnId、createdFromStateRevision、status を持つ。accept_assumption/reject_assumption/modify_assumption は proposalId、expectedStateRevision、value/unit、confidence、sourceText を持つ。pending は hard apply しない。reject は復活させず、modify は旧を superseded、新 proposal を作る。

CorrectionOperation は replace|remove|supersede|restore。CorrectionTarget は factId/proposalId/commandId/taskRef/eventRef/slot の union、CorrectionEnvelope は correctionId、operation、target、replacementCommand、sourceText、confidence、expectedStateRevision を持つ。target 非一意は clarification、revision/source mismatch は stale。replace は旧 fact を superseded として履歴化、remove と restore を区別し、複数訂正は atomic に検証する。

状態遷移、schema/enum/range/NaN/Infinity/size/authorization を deterministic に検証し、reject/invalid/stale は partial apply せず accepted/rejected/pending を保持し preview を stale 化する。

## 失敗・concurrency・security

provider failure は turn-wide deterministic fallback、追加 AI call なし、rules/AI merge なし。active request は一件、turn/request/revision mismatch は無効。全 sourceText/reason/task/title は untrusted JSON data、prompt/action/ref/option ID に昇格させず escaped text のみ描画。

## persistence・migration / 触らない範囲

proposal/correction/request は当面 session-local。将来 schemaVersion/userId/weekStartDate/pending proposals/stateRevision を versioned/idempotent に移行する。UI/CSS、scheduler 全面改造、save/approval副作用、複雑 recurrence、src の無関係差分、git write は触らない。

## 受け入れ条件

1. lifecycle と audit trail が strict assertion できる。2. rejected/accepted/pending を混同しない。3. invalid/ambiguous/stale/duplicate は atomic reject。4. correction 後 scheduler/preview stale を再計算。5. assumption は hard apply されない。

## P1-P7・テスト・リスク

P1/P2 は明示訂正・IME/submit、P3 は invalid proposal/correction/injection、P4 は stale preview/retry、P5 は migration/emoji、P6 は provider fallback/exam/non-exam、P7 は DA-ASSUMPTION-001/DA-CORRECTION-001 traceability。unit/contract/integration/property/roleplay を行い、real model は DA3c に委譲する。PlanningIntakeState の破壊的変更と旧 preview の回帰がリスクである。

## Codexへの実装指示

対象を限定し、docs/ai/codex-task-guide.md に従う。npm test/build、diff check、status を報告し、git add/commit/push/reset/restore/checkout/stash は行わない。

