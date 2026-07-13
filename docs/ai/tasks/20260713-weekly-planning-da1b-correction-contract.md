# DA1b: assumption decision and correction contract

Status: **queued — DA1 after**
Priority: High
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-ASSUMPTION-001, DA-CORRECTION-001, DA-PREVIEW-001
Dependencies: DA1

正式責務名はassumption decision and correction contract。旧来のcorrectionだけのtaskとして扱わない。

## Scope / exact types

pending proposalのaccept/reject/modify/expiry/supersede、target resolution、replace/remove/supersede/restore、audit history、preview stale、scheduler triggerを扱う。現行intake adapter/reducerを再調査し、全面置換しない。

```ts
type Confidence = "high" | "medium" | "low";
type AssumptionDecisionCommand = {
  type: "accept_assumption" | "reject_assumption" | "modify_assumption";
  proposalId: string;
  expectedStateRevision: number;
  value?: AssumptionValue;
  unit?: AssumptionUnit;
  confidence: Confidence;
  sourceText: string;
};
type CorrectionOperation = "replace" | "remove" | "supersede" | "restore";
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

proposal transitionはpending→accepted/rejected/superseded/expired。modifyは旧をsuperseded、新をpending。CorrectionEnvelope内部はatomic。同turnの複数Envelopeは独立validateし、明確な訂正のaccepted結果を曖昧な訂正で破棄しない。accepted commandとclarificationを直交保持。rejected correctionは元factを壊さない。target非一意はclarification、stale/privateはreject。replaceはaudit、remove/restoreを区別。accepted後はrevisionを進めpreview stale化しscheduler再計算。

## Validator / failure / concurrency / persistence / security

schema/enum/finite/range/size/status/sourceFactRefs/revision/authorization/target uniquenessをdeterministic検証。duplicate decisionをhidden resurrectionさせない。interpreter/planner/staleはDA1/DA2 categoryへ委譲。active request一件、session-local。sourceText/reason/title/memoはuntrusted JSON data。save/repository/UI/scheduler全面改修はnon-goal。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA1b | hostile/invalid boundary |
| P4 | Covered by another task | approval | preview/save/idempotency |
| P5 | Not applicable or regression only | future persistence / DA2 | migration scope |
| P6 | Applicable | DA1b | fallback and exam/non-exam |
| P7 | Applicable | DA1b | typed refs/revision/diagnostics trace |



## Acceptance / tests / commands

unit: lifecycle、target、confidence、revision、audit。contract: multiple envelopes independent、clarification orthogonal、preview stale。integration: WP-DA turns 3〜11、scheduler trigger、exam regression。property/fuzz: ambiguity、duplicates、NaN/Infinity、untrusted strings、independent envelope behavior。roleplay: accept/reject/modify、P3/P6。real-modelはcommand fixture replay。既存test/build/lint、diff check、status、Git write禁止。
