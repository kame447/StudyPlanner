# DA0a: assumption proposal foundation

Status: **blocked — Gate P4 verification後**
Priority: High
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-ASSUMPTION-001, DA-INTERPRET-001, DA-PREVIEW-001
Dependencies: Gate P4 → DA0a → DA0

## Scope / entry / exit

AIのproposal draftをdeterministic coreがcanonicalなpending proposalへ変換する最小基盤。EntryはGate P4の採否確定。Exitはschema、deterministic ID、public source validation、stale validation、session-local保持、pending preview marker、hard apply禁止をunit/contract/integrationで証明すること。

Current pathは `userText → interpreter → candidate validator → adapter/reducer → draft/preview`。候補ファイルは `src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts`、`weeklyPlanningCandidateValidator.ts`、`weeklyPlanningCommandAdapter.ts`、`weeklyPlanningIntakeReducer.ts`、`weeklyPlanningDraftRequestAdapter.ts` とdialogue/preview境界を実コードで再確認する。

## Exact types

```ts
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

AI出力はdraftのみ。proposalId、conversationId、turnId、revision、statusをAIに生成させない。coreがdraft+source+revisionからdeterministic IDを発行する。

## Transition / validator / failure

no draft→draft validation→canonical pending、invalid/private/unknown source→rejected diagnostic、source revision mismatch→stale、pending→preview use only。accept/reject/modify/expiry/supersedeはDA1b。schema、enum、finite/range、size、public fact registry、conversation/turn/revision、authorization、duplicateをvalidateする。

interpreter failure、planner failure、stale/cancelはDA2/DA1のcategoryを再利用するが混同しない。active request一件、revision monotonicity、request混入なし。session-localのみ。reason/source/titleはuntrusted JSON data。save、repository、UI承認、migration、dialogue planner、relative constraint、scheduler全面改修はnon-goal。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA0a | hostile/invalid boundary |
| P4 | Covered by another task | approval | preview/save/idempotency |
| P5 | Not applicable or regression only | future persistence / DA2 | migration scope |
| P6 | Applicable | DA0a/DA2 | fallback and exam/non-exam |
| P7 | Applicable | DA0a | typed refs/revision/diagnostics trace |



## Acceptance / tests / commands

unit: draft schema、ID、public source、stale。contract: draftとcanonicalの分離、pending marker。integration: unknown duration→pending preview、exam regression。property/fuzz: duplicate/long strings/NaN/Infinity/revision。roleplay: WP-DA-001 turns 3〜5、P3/P6。real-modelはredacted candidate replayのみ。既存test/build/lintを確認して実行し、`git diff --check`とdocs-only statusを確認する。Git add/commit/push/reset/restore/checkout/stashは禁止。
