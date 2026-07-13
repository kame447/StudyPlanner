# DA3b: feasibility consultation

Status: **queued — DA3a after**
Priority: Medium
Parent: ../../architecture/weekly-planning-dialogue-architecture-v4.md
Requirement IDs: DA-FEASIBILITY-001, DA-GOAL-001, DA-PREVIEW-001
Dependencies: DA3a

## Scope / exact contract / path

schedulerのdeterministic outputをfeasibility snapshot、bottleneck、unscheduled task、priority/split/defer optionへ変換する。AIは値を再計算せずdeterministic option IDだけを提示する。現行generator/diagnostics/preview outputを再調査する。

```ts
type FeasibilitySummary = {
  classification: "feasible" | "partially_feasible" | "infeasible" | "unknown";
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

unknown（材料不足）、infeasible（制約で不可能）、unsupported（capability未対応）を分ける。option IDはdeterministic issuer。summary→AllowedDialogueActions→planner response。numeric nonnegative/finite、public/current refs、stateRevision/previewIdをvalidate。pendingはeligible_with_pending_assumption、hard blockerはblocked、staleはdiscard。AI placement/approval/save、scheduler全面改修、UI、migrationはnon-goal。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Regression only | DA2 | submit/request lifecycle |
| P2 | Covered by another task | DA2 | IME/keyboard |
| P3 | Applicable | DA3b | hostile boundary |
| P4 | Covered by another task | approval | stale/save |
| P5 | Not applicable | future persistence | no migration |
| P6 | Applicable | DA3b/DA2 | fallback/exam |
| P7 | Applicable | DA3b | ref/revision trace |



## Acceptance / tests / commands

unit numeric/classification/options、contract snapshot/action、integration scheduler→dialogue、property nonnegative/conservation/option determinism、roleplay WP-DA turns7〜11/P3/P6。real modelはwording rubricのみDA3c。値をAIが再計算せず、eligibilityなしpreview offerがないこと。既存scripts、diff check、status、Git write禁止。
