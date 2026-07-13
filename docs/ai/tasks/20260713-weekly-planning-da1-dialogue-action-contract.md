# DA1: DialogueStateSnapshotとDialogueAction/response contract

Status: **queued — DA0 after**
Priority: High
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-ACTION-001, DA-RESPONSE-001, DA-FALLBACK-001
Dependencies: DA0

## Scope / current path / entry / exit

snapshotから有限action、allowed topic/option/fact field、response parts、preview offerを検証可能にする。現行dialogue renderer、state summary、decision taxonomy、public fact境界を再調査する。EntryはDA0 preview contract。Exitはvalid responseだけがpublic factをrenderし、invalid responseが全体rejectされること。

## Exact types and validator table

```ts
type DialogueActionKind =
  | "acknowledge" | "summarize_and_ask" | "confirm_reference"
  | "propose_assumption" | "explain_feasibility" | "offer_preview"
  | "answer_clarification" | "explain_capability_gap" | "fallback";

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

type DialoguePlannerResultEnvelope = {
  conversationId: string;
  turnId: string;
  requestId: string;
  inputStateRevision: number;
  outputStateRevision: number;
  responsePlan: DialogueResponsePlan;
};
```

response partはtext/fact/question/optionの有限union。assumptionはPendingAssumptionProposalDraftのみ、canonical proposalやprivate/raw diagnosticsは不可。`offer_preview`はpreviewId/stateRevision一致/stale=false、`propose_assumption`はdraft/sourceFactRefs、`fallback`はproposal/preview/private diagnostic/extra call禁止。unknown action/ref/field/topic/optionは全体reject、response再parseでstateを更新しない。

## State / failure / concurrency / persistence / security

accepted/rejected/pending/correction/feasibility/preview snapshotをimmutable入力として使う。askedTopicHistory/activeQuestionとallowedQuestionTopicsを別管理する。interpreter failure、planner failure、stale discardを別diagnosticにする。active request lifecycleはDA2。contractはsession-local、save/migration/repositoryはnon-goal。stringsはuntrusted JSON data。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA1 | hostile/invalid boundary |
| P4 | Covered by another task | approval | preview/save/idempotency |
| P5 | Not applicable or regression only | future persistence / DA2 | migration scope |
| P6 | Applicable | DA1/DA2 | fallback and exam/non-exam |
| P7 | Applicable | DA1 | typed refs/revision/diagnostics trace |



## Acceptance / tests / commands

unit: union、registry、allow-list、no-reask。contract: action validator、envelope、revision。integration: snapshot→planner→validator→renderer、clarification orthogonality。property/fuzz: unknown/private IDs、duplicate option、oversize/NaN。roleplay: WP-DA turns 4〜11、P3/P6。real-modelはresponse fixture replay。既存scripts、diff check、status、Git write禁止。
