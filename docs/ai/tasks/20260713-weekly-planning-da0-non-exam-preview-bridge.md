# DA0: non-exam StudyTaskScopeをweekly previewへ橋渡しする

Status: **blocked — Gate P4とDA0aの後**
Priority: High
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-INTERPRET-001, DA-PREVIEW-001, DA-FALLBACK-001
Dependencies: Gate P4 → DA0a

## Scope / entry / exit

accepted一般目標、explicit duration、DA0a pending assumptionを `StudyTaskScope → GenericWeeklyWorkItem → existing candidate generator → preview`へ渡す。multiple task、priority、eligibility、unscheduled/capability/missing分類、exam regressionだけを扱う。proposal lifecycleはDA0a/DA1b、approval、keyboard、migration、UI overhaul、scheduler全面改修は扱わない。EntryはDA0a canonical contractとGate P4。Exitはnon-exam explicit/unknown/invalidとexam pathが分類・検証されること。

Current path: `runWeeklyPlanningIntakePipelineWithInterpreter`、`weeklyPlanningIntakeReducer.ts`、`weeklyPlanningDraftRequestAdapter.ts`、`weeklyDraftCandidateGenerator.ts`、既存busy interval/preview。実コードを再調査し、架空fileを断定しない。

## Exact domain / state

```ts
type GenericWeeklyWorkItem = {
  taskRef: string;
  title: string;
  subject?: string;
  quantity?: { amount: number; unit: AssumptionUnit };
  durationMinutes?: number;
  priority?: number;
  sourceFactRefs: string[];
  eligibility:
    | "eligible"
    | "eligible_with_pending_assumption"
    | "missing_information"
    | "unsupported"
    | "rejected";
};
```

explicit durationはfinite positive minutesへ、unknownはpending marker付きへ、invalid/zero/negative/oversized/unit外はrejectedへ。各taskを独立評価し、invalid一件で他件のdiagnosticを失わない。preview全体のeligibilityはdeterministicに算出する。AIはplacement、required/available、option IDを発行しない。

## Validator / failure / concurrency / persistence / security

title/subject/taskRef/sourceFactRefs、unit、duration/quantity、priority、revision、preview、user scopeをvalidateする。interpreter/planner/staleの三系統をDA2/DA1へ委譲し、candidate generator errorはcapability diagnostic。active request一件、stale preview破棄。session-local、既存draft localStorage契約のみ。user text/title/rawTextはuntrusted escaped JSON。save/approval/repository/keyboard/migrationはnon-goal。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Covered by another task | DA2 | request/submit lifecycle |
| P2 | Covered by another task | DA2 | IME/focus/keyboard |
| P3 | Applicable | DA0 | hostile/invalid boundary |
| P4 | Covered by another task | approval | preview/save/idempotency |
| P5 | Not applicable or regression only | future persistence / DA2 | migration scope |
| P6 | Regression only | DA0 | fallback and exam/non-exam |
| P7 | Applicable | DA0 | typed refs/revision/diagnostics trace |



## Acceptance / tests / commands

unit: adapter/eligibility/classification。contract: generator boundary、pending marker、no save。integration: explicit/unknown/multiple/existing schedule/exam。property/fuzz: order stability、invalid isolation、bounds、untrusted strings。roleplay: WP-DA-001 turns 1〜9、WP-RP-001 regression。real-modelはset_study_goal fixture replayのみ。既存test/build/lintとdiff check、statusを実行しGit write禁止。
