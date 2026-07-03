# weeklyPlanning R1 completion audit report

## Scope

This report records the R1 completion audit for command boundary completion, reducer thinning, legacy fallback isolation, and R1 regression coverage before merging `feat/weekly-planning-draft-mvp` to main.

## Audit result

- Reducer: no Japanese natural-language regular expressions or direct legacy parser calls were found in `weeklyPlanningIntakeReducer.ts`. The reducer orchestrates command parsing/application, calls `applyLegacyWeeklyPlanningFallback` once, and finalizes through `finalizeState`.
- Missing/status boundary: status resolution, questions, uniqueness, `shouldCreateDraft`, `shouldSavePlan: false`, and priority missing inference are centralized in `weeklyPlanningMissingStatus.ts`. Command application still performs command-local missing add/remove side effects.
- Legacy fallback: legacy weekly fallback remains isolated in `weeklyPlanningLegacyFallback.ts`; branch A and branch B are named predicates/functions, and the current `previousState` truthiness behavior is intentionally documented until R2+ semantics work.
- `tasks_or_goals`: branch B now removes `tasks_or_goals` only on the tasks replacement path; regression coverage exists in reducer and pipeline tests.
- Command boundary: command types and adapter mappings are present for R1 commandized flows. Parser files return commands and do not directly mutate `PlanningIntakeState`.
- Busy interval tests: R1 now fixes the current implicit rules for date-less unavailable expansion, all-day unavailable, start-only default 60 minutes, end plus duration, and meal end-only default 60 minutes.
- Known placementScoring failure: the failing timetable template test was a fixture mismatch (`weekday` outside the one-day planning window), not a scheduler design issue. The fixture now matches the planning start date.

## Deferred after main merge

- Legacy fallback first-turn/continuation semantics and eventual fallback removal.
- R2+ parser/features such as deadline expressions, completion conditions, unit kind generalization, question planning, life profiles, progress records, replanning, scheduler unification, UI changes, save/approval route changes, LLM connection, and LangGraph.
- Any broader scheduler quality/integration work beyond the R1 fixed regressions.

## Verification

Node 22 verification is run as part of the merge-readiness goal and reported in the final task response.
