# DA3b: feasibility consultation

Status: **queued — DA3a after**
Priority: Medium
Parent: [weekly-planning-dialogue-architecture-v4.md](../../architecture/weekly-planning-dialogue-architecture-v4.md)
Requirement IDs: DA-FEASIBILITY-001, DA-GOAL-001, DA-PREVIEW-001
Traceability: [weekly-planning-roleplay-test-plan.md](../../testing/weekly-planning-roleplay-test-plan.md)
Dependencies: DA3a → DA3b

## Scope / entry / exit

schedulerのdeterministic outputをfeasibility snapshot、bottleneck、unscheduled task、priority/split/defer optionへ変換する。AIは値を再計算せずdeterministic option IDだけを提示する。現行generator/diagnostics/preview outputを再調査する。

EntryはDA3a relative constraint resolution完了。Exitはclassification、数値保存則、public refs、deterministic options、pending eligibility、mentor optionがunit/property/roleplayで固定されること。

~~~ts
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
~~~

unknown（材料不足）、infeasible（制約で不可能）、unsupported（capability未対応）を分ける。option IDはdeterministic issuerが発行する。summary→AllowedDialogueActions→planner responsePartsの順で接続する。

numeric nonnegative/finite、public/current refs、stateRevision/previewIdをvalidateする。pendingはeligible_with_pending_assumption、hard blockerはblocked、stale async outputはdiscard。AI placement/approval/save、scheduler全面改修、UI、migrationはnon-goalである。

goal dialogueは受理済みgoalを再質問せず、次の未確認topicまたはdeterministic feasibility optionを一つ提示する。自然文品質はDA3c rubricへ渡す。

## P1〜P7 responsibility

| Perspective | Applicability | Owning task | Required assertion |
| --- | --- | --- | --- |
| P1 | Regression only | DA2 | submit/request lifecycle |
| P2 | Regression only | DA2 | IME/keyboard/focus |
| P3 | Applicable | DA3b | hostile numeric/ref boundary |
| P4 | Covered by another task | approval | stale/save |
| P5 | Not applicable | future persistence | no migration |
| P6 | Applicable | DA3b、DA2 | fallback/exam |
| P7 | Applicable | DA3b | numeric/options/preview trace |

## Acceptance / tests / commands

unitはnumeric/classification/options、contractはsnapshot/action/responseParts、integrationはscheduler→dialogue、propertyはnonnegative/conservation/option determinism。roleplayはWP-DA turns 7〜11、DA-GOAL-001、P3-TEXT-FACT-LEAK-001、P6-PLANNER-FAILURE-001。real-model wording rubricはDA3cだけで行う。値をAIが再計算せず、eligibilityなしpreview offerがないこと。既存scripts、diff check、status、Git write禁止。
