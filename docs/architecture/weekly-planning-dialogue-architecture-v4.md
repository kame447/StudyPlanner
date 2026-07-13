# weeklyPlanning 対話アーキテクチャ v4（state-grounded AI dialogue）

Status: **設計の正（v4 DoR）**
最終更新: 2026-07-13

Product goal: [weekly-planning-spec.md](../weekly-planning/weekly-planning-spec.md)
Historical evidence: [weekly-planning-dialogue-architecture.md](weekly-planning-dialogue-architecture.md)、[weekly-planning-nl-capability-model.md](weekly-planning-nl-capability-model.md)

## 1. 範囲と不変条件

対象はopening、週間対話、exam/non-exam intake、pending assumption、correction、preview、承認前draft。保存済み予定のAI自動変更、AI approve/save/delete、複雑recurrence、sharing、scheduler全面書換えは対象外。

- provider時の自然文意味解釈はsingle AI interpreter。AIとrules parserをmergeしない。
- typed candidate以降のnormalize、validate、adapter、reducer、scheduler、preview、approval/saveはdeterministic core。
- AIはstate、scheduler、repository、save、approve、deleteを直接変更しない。
- previewは未承認draft。explicit UI approvalまでsaveしない。
- 通常turnはinterpreter + plannerの最大2 call、openingは最大1 call。empty candidatesは正常結果。
- user-originated stringはuntrusted JSON dataであり、action、factRef、option ID、prompt命令へ昇格させない。

```text
userText + structured context
  → single AI interpreter → typed candidates
  → normalize / validate / adapter / reducer
  → scheduler / availability / feasibility / preview
  → DialogueStateSnapshot + AllowedDialogueActions
  → AI dialogue planner → response validator
  → deterministic fact rendering → UI
```

## 2. proposal draftとcanonical proposal

```ts
type Confidence = "high" | "medium" | "low";
type AssumptionValue = string | number | boolean;
type PlanningAssumptionSlot =
  | "duration" | "quantity" | "planning_period" | "priority" | "completion_target";
type AssumptionUnit =
  | "minutes" | "hours" | "pages" | "problems" | "words"
  | "lessons" | "chapters" | "count" | "unknown";

type PendingAssumptionProposalDraft = {
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonText?: string;
  sourceFactRefs: string[];
};

type PendingAssumptionProposal = {
  proposalId: string;
  conversationId: string;
  slot: PlanningAssumptionSlot;
  targetRef: string;
  proposedValue: AssumptionValue;
  proposedUnit?: AssumptionUnit;
  reasonText?: string;
  sourceFactRefs: string[];
  createdAtTurnId: string;
  createdFromStateRevision: number;
  status: "pending";
};
```

AI responseは `assumptionProposalDraft` のみを含み、proposalId、conversationId、turnId、revision、statusを生成しない。deterministic coreがdraft、sourceFactRefs、current revisionからproposalIdとcanonical recordを生成する。private/unknown/stale sourceはcanonical化しない。

proposal lifecycleはDA1bが管理する。

```text
pending → accepted | rejected | superseded | expired
```

pendingはpreviewで使用できるが、使用したことを明示し、hard apply/saveしない。rejectを復活させず、modifyは旧proposalをsuperseded、新proposalをpendingにする。

## 3. snapshot、asked history、feasibility

```ts
type AskedTopicRecord = {
  topicId: string;
  askedAtTurnId: string;
  askedAtStateRevision: number;
  status: "asked" | "answered" | "superseded" | "expired";
};

type ActiveQuestion = {
  questionId: string;
  topicId: string;
  askedAtTurnId: string;
  askedAtStateRevision: number;
  allowedAnswerKinds: string[];
};

type FeasibilityClassification =
  | "feasible" | "partially_feasible" | "infeasible" | "unknown";

type FeasibilitySummary = {
  classification: FeasibilityClassification;
  requiredMinutes: number;
  availableMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  unscheduledTaskRefs: string[];
  bottleneckFactRefs: string[];
  conflictFactRefs: string[];
  deterministicOptionIds: string[];
  previewEligibility:
    | "eligible"
    | "eligible_with_pending_assumption"
    | "blocked"
    | "unsupported";
};
```

`DialogueStateSnapshot`はconversationId、stateRevision、acceptedFacts、rejectedCommands、pendingAssumptionProposals、correctionHistory、planningRange、existingEvents、feasibility、preview、allowedQuestionTopics、askedTopicHistory、activeQuestion、lastResolvedQuestionId、recentHistoryを持つ。

allowedQuestionTopicsは今聞いてよいtopic、askedTopicHistoryは既に聞いたtopic、activeQuestionは回答待ちの質問である。answered済みtopicを理由なく再質問せず、revision変更だけでは再質問しない。activeQuestionへの短答をinterpreter groundingに使い、fallbackでも無限再質問しない。

## 4. action/response contract

```ts
type DialogueActionKind =
  | "acknowledge" | "summarize_and_ask" | "confirm_reference"
  | "propose_assumption" | "explain_feasibility" | "offer_preview"
  | "answer_clarification" | "explain_capability_gap" | "fallback";

type PublicFactField =
  | "title" | "subject" | "date" | "weekday" | "startTime" | "endTime"
  | "durationMinutes" | "requiredMinutes" | "availableMinutes"
  | "scheduledMinutes" | "unscheduledMinutes" | "planningRange"
  | "previewBlockCount";

type AllowedDialogueAction = {
  action: DialogueActionKind;
  allowedQuestionTopicIds: string[];
  allowedOptionIds: string[];
  allowedFactFields: PublicFactField[];
  previewOfferAllowed: boolean;
  assumptionProposalAllowed: boolean;
};

type AllowedDialogueActions = {
  stateRevision: number;
  actions: AllowedDialogueAction[];
};

type DialogueResponsePart =
  | { kind: "text"; text: string }
  | { kind: "fact"; factRef: string; field: PublicFactField; formatterId?: string }
  | { kind: "question"; topicId: string; optionIds?: string[] }
  | { kind: "option"; optionId: string };

type DialogueResponsePlan = {
  action: DialogueActionKind;
  responseParts: DialogueResponsePart[];
  factRefs: string[];
  questionTopics: string[];
  assumptionProposalDraft?: PendingAssumptionProposalDraft;
  previewOffer?: { previewId: string; stateRevision: number };
};

type DialoguePlannerResultEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  outputStateRevision: number;
  responsePlan: DialogueResponsePlan;
};
```

actionは任意stringにしない。text partは接続語・説明文に限定し、日時、分数、件数、タイトル、範囲はfact partで表示する。responseはaction、field、factRef、topic、option、previewId、revisionをallow-listで検証し、invalidなら全体rejectしてdeterministic fallbackを使う。

最低validator:

| action | 必須 | 禁止 |
| --- | --- | --- |
| acknowledge | allowed fact | save/approve |
| summarize_and_ask | allowed topic | answered topicの理由なし再質問 |
| confirm_reference | public reference fact | 空sourceの利用中断定 |
| propose_assumption | draft/sourceFactRefs | canonical ID/status、hard apply |
| explain_feasibility | deterministic facts/options | AI再計算、任意option |
| offer_preview | previewId、revision一致、stale=false | save/approve、blocker中のeligible |
| answer_clarification | target topic/fact | accepted commandの破棄 |
| explain_capability_gap | capability fact | unsupported preview |
| fallback | deterministic fact | proposal、preview、private diagnostic、extra call |

## 5. correctionとatomicity

```ts
type CorrectionOperation = "replace" | "remove" | "supersede" | "restore";
type CorrectionTarget = {
  factId?: string;
  proposalId?: string;
  commandId?: string;
  taskRef?: string;
  eventRef?: string;
  slot?: PlanningAssumptionSlot;
};
type CorrectionEnvelope = {
  correctionId: string;
  operation: CorrectionOperation;
  target: CorrectionTarget;
  replacementCommand?: unknown;
  sourceText: string;
  confidence: Confidence;
  expectedStateRevision: number;
};
```

一つのCorrectionEnvelope内部はatomicにvalidate/applyする。同一turnの複数Envelopeは独立評価し、明確な訂正のaccepted結果を曖昧な訂正のrejectで破棄しない。accepted commandとclarification requestを直交保持し、rejected correctionは元factを壊さない。target非一意、unknown/private/stale target、revision/source mismatchはそのEnvelopeだけをreject/clarificationとする。replaceは旧factをsupersededとしてaudit historyへ残し、remove/restoreを区別する。accepted decision/correction後はstateRevisionを進めpreviewをstaleにする。confidenceはnumberではなくConfidence unionである。

## 6. request、fallback、persistence

```ts
type DialogueTurnEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  userText: string;
  createdAt: string;
};
```

一conversation一active request。identity/revision mismatch、mode reset、history clear、unmount、cancel、timeout後の旧responseはstate/history/status/previewへ反映せず、stale由来のfallbackも表示しない。

- Interpreter failure: provider unavailable/exception/timeout/parse/schema。state適用前でturn-wide rules fallback。追加AI callなし。empty candidatesはfailureでない。
- Dialogue planner failure: invalid action/ref/field/topic/option/preview、planner exception/timeout。accepted stateを保持し、rules semantic parserを再実行せずdeterministic renderer fallback。追加AI callなし。
- Stale/cancelled: responseを破棄するだけで、ユーザー向けfailure messageを返さない。

previewはpreviewId/stateRevisionに束縛し、staleならsave不可。会話/request/proposalはsession-local、既存draft block localStorageは維持し、reloadで自動再実行しない。

## 7. approval ledgerとidempotency

```ts
type WeeklyDraftApprovalItemStatus =
  | "pending" | "saving" | "saved" | "failed" | "skipped_duplicate";

type WeeklyDraftApprovalItem = {
  sourceDraftBlockId: string;
  status: WeeklyDraftApprovalItemStatus;
  savedPlanId?: string;
  attemptCount: number;
  lastErrorCode?: string;
  updatedAt: string;
};

type WeeklyDraftApprovalOperation = {
  approvalOperationId: string;
  userId: string;
  previewId: string;
  previewStateRevision: number;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "partially_saved" | "completed" | "failed";
  items: WeeklyDraftApprovalItem[];
};

type ApprovedPlanSource = {
  sourceType: "weekly_draft";
  sourceDraftBlockId: string;
  approvalOperationId: string;
};
```

idempotency keyは **userId + sourceDraftBlockId**。approvalOperationIdは監査/batch metadataでありkeyに含めない。別operation IDでも同じuser/source blockから2件目を保存しない。itemごとにpartial failure/retry/crashを扱い、operation statusはitemsから導出可能にする。AIはoperationを作成・開始しない。

## 8. keyboard decision

IME中に送信しない、multiline入力、button/keyboardの同一turn重複抑止、focus restore、Tab順は確定。Enter、Shift+Enter、Ctrl/Meta+Enterの最終割当はDA2のopen decisionであり、roleplayは決定前にbindingをstrictにしない。

Option AはEnter=送信/Shift+Enter=改行、Option BはEnter=改行/Ctrl/Meta+Enter=送信。日本語IME、長文、accessibility、mobile、誤送信を判断軸にする。

## 9. current queue

Gate P4完了前にopen implementation taskはない。

| 順 | item | status |
| --- | --- | --- |
| 0 | Gate P4 | active verification gate |
| 1 | DA0a assumption proposal foundation | blocked — Gate P4 verification後 |
| 2 | DA0 non-exam preview bridge | blocked — Gate P4とDA0aの後 |
| 3 | DA1 dialogue action/response contract | queued |
| 4 | DA1b assumption decision and correction contract | queued |
| 5 | Draft approval idempotency | queued |
| 6 | DA2 state-grounded dialogue orchestrator | queued |
| 7 | DA3a relative constraint domain | queued |
| 8 | DA3b feasibility consultation | queued |
| 9 | DA3c conversation evaluation | queued |

旧D1〜D7、P4〜P9、T6、v3 stageはhistorical/supersededでありcurrent queueへ戻さない。
