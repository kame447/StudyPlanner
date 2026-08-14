# Weekly planning conversation quality re-verification

## Status

- active branch: `agent/weekly-planning-conversation-quality`
- base: `main@be0c483d779be315f10ccf3f34adb9c7420e9631`
- draft PR: pending publication
- current work unit: fresh-session semantic entry routing, Issue #115
- next confirmed dialogue gap: completed-work pace clarification selection, remaining part of Issue #118

## Start gate

Work started only after all three conditions were rechecked on GitHub on 2026-08-14.

- PR #129 is merged: <https://github.com/kame447/StudyPlanner/pull/129>
- `main` points at PR #129 merge commit `be0c483d779be315f10ccf3f34adb9c7420e9631`
- the `main` push CI run completed successfully: <https://github.com/kame447/StudyPlanner/actions/runs/31783727179>

No conversation-quality code or Issue was changed before this gate passed.

## Scope and ownership boundary

This work keeps the Stable V5 boundary intact.

- AI owns raw Japanese meaning, conversational context, corrections, quantity role, time/date expressions, authorization meaning, and the new entry category.
- deterministic code owns schema validation, formal binding, Fact Graph lifecycle, revision, idempotency, question priority, readiness, scheduler input, preview, approval, and save.
- no raw Japanese regex, keyword, or substring parser may become semantic truth.
- Luna does not receive safety, state-integrity, clock, approval, or persistence authority.

Privacy, longitudinal personalization, multi-device approval, saved-preview migration, and screen separation remain outside this branch.

## PR and Issue inventory

### PR #109

PR #109 established the Stable V5 baseline and is present on `main`. Current code still contains the contracts recorded in its merge description: structured semantic normalization with at most one repair, Fact Graph revision/idempotency, deterministic readiness/scheduler, typed renderer input, preview correction, draft promotion, and approval application boundaries.

Representative current evidence:

- `src/features/weeklyPlanning/semantic/weeklyPlanningSemanticPipelineV5.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5RuntimeExecutor.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5TurnIdempotency.ts`
- `src/features/weeklyPlanning/application/weeklyPlanningStableV5PreviewExecution.ts`
- `src/components/NaturalLanguageAssistant.weeklyPlanningControls.test.tsx`

No unfinished item was inferred merely from PR #109 being closed.

### PR #111

PR #111 contains no independent production change. Its own description says the documentation was absorbed into PR #109 and the separate PR would not be used. Current `main` therefore has no remaining implementation obligation that belongs uniquely to #111.

### PR #120

PR #120 is present on `main` and implemented current-time grounding, active-fact projection, localized repair, pass-over/reopen policy, focused contextual answers, observed-pace calculation, prompt cleanup, and real-API observation infrastructure.

Its follow-up status must be split by current code rather than Issue state.

- Issue #116 is closed and its stale prompt-wording cleanup is absent from current tests.
- Issue #118 is open but partially implemented. `weeklyPlanningGenericWorkEstimation.ts` and `weeklyPlanningObservedPaceEstimate.test.ts` already prove `30 pages / 90 minutes -> remaining 50 pages / 150 minutes`, provenance, mismatch rejection, and ambiguity rejection. The remaining gap is dialogue selection when completed-work duration is missing: `weeklyPlanningGenericWorkItems.ts` skips completed workloads and emits `missing_effort_estimate` for the remaining workload, while `weeklyPlanningStableV5RuntimeQuestions.ts` still asks for the remaining total directly. The intended progress-first clarification is therefore not complete.
- Issue #128 is a saved-preview approval compatibility migration. It does not change current-turn conversation semantics and is excluded from this branch.

### PR #124

PR #124 is present on `main`. Internal OpenAI purposes resolve to `gpt-5.6-luna` in `workers/ai-proxy/src/modelPolicy.ts`, and direct development/eval configuration defaults to Luna. The merge itself is not evidence that an old heuristic can be removed; every deletion still needs an ablation plus regression evidence.

### PR #127

PR #127 is present on `main` and reconnects the audited Playwright browser suite. It covers the deterministic UI/browser baseline, including synchronous duplicate submission, dialog/tab semantics, cross-midnight validation, and weekly preview-promotion idempotency. A final real-browser conversation/preview observation is still required for this branch.

### Open-Issue truth on current main

- Issue #43 remains open, but its production ownership contract is implemented by `weeklyPlanningTurnController.ts`, `weeklyPlanningTurnApplication.ts`, and their duplicate/stale/cancel/keyboard/component regressions. It is an administrative stale-open candidate, not evidence of missing code.
- Issue #45 is trace privacy/lifecycle and is excluded.
- Issue #47 is longitudinal personalization and is excluded.
- Issue #51 is server-side multi-device approval idempotency and is excluded.
- Issue #52 is UI separation and is explicitly excluded.
- Issue #89 is empty trace-session transport/lifecycle behavior and is not a dialogue-quality change.
- Issue #115 was genuinely incomplete on `main`: `NaturalLanguageAssistant` called `looksLikeWeeklyPlanningRequest`, whose truth condition was a week expression plus at least two `N時間` mentions.
- Issue #118 is partially complete as described above.
- Issue #128 is outside the current conversation-quality scope.

No new Issue was created.

## Existing conversation heuristics and contracts

The following behaviors exist in current Stable V5 and remain regression targets. Names are grouped by current implementation responsibility rather than by historical PR wording.

- short answers and machine target binding: `weeklyPlanningFocusedContextualAnswerV5.ts`, `weeklyPlanningStableV5ContextualAnswer.ts`
- pending planning range and canonical date grounding: `weeklyPlanningPlanningWindowCanonicalContractV5.ts`, `weeklyPlanningStableV5DialogueCanonicalDateGrounding.test.ts`
- clarification and field priority: `weeklyPlanningStableDialoguePolicyV5.ts`, `weeklyPlanningStableV5RuntimeQuestions.ts`
- quantity, completed, remaining, and duration: `weeklyPlanningSemanticEvidenceV5.ts`, `weeklyPlanningGenericWorkEstimation.ts`
- semantic ambiguity: `weeklyPlanningSemanticPipelineV5.ts`, `weeklyPlanningStableV5RuntimeExecutor.test.ts`
- modifier target and cross-turn binding: `weeklyPlanningExistingEntityBindingV5.ts`, `weeklyPlanningCrossTurnEntityBindingV5.test.ts`
- phase/focused routing: `weeklyPlanningSemanticFocusedPreRoutesV5.ts`, `weeklyPlanningSemanticFocusedRepairRoutesV5.ts`
- grounding and repair: `weeklyPlanningSemanticResponseValidationV5.ts`, `weeklyPlanningSemanticGenericRepairRouteV5.ts`
- pass-over and reopen: `weeklyPlanningStableRepairPolicyV5.ts`, `weeklyPlanningStableV5RepairAgendaIntegration.test.ts`
- active-only public projection: `weeklyPlanningStableV5SemanticContext.ts`
- draft-ready, correction, and re-preview: `weeklyPlanningStableV5ResponseRouting.ts`, `weeklyPlanningPreviewCorrectionLifecycle.integration.test.ts`
- no-op revision/idempotency and preview retention: `weeklyPlanningStableV5TurnIdempotency.ts`, `weeklyPlanningStableV5InstrumentedRuntimeExecutor.test.ts`
- preview promotion and approval boundary: `NaturalLanguageAssistant.weeklyPlanningControls.test.tsx`, `weeklyPlanningApprovalApplication.ts`

These entries are not considered verified for this branch until their relevant focused/full regressions and the final real conversation pass.

## Work unit 1: fresh-session entry routing

### Confirmed failure on main

`来週の勉強予定を立てたい` did not satisfy the two-duration regex and therefore could not enter Stable V5 from the default chat mode without manual mode selection.

### Change

- replace production `looksLikeWeeklyPlanningRequest` routing with a strict `chat | weekly_planning | ambiguous` AI response schema
- use existing `weekly_planning_interpreter` purpose, which resolves to Luna
- keep the focused router limited to meaning; it cannot decide readiness, scheduling, preview, approval, or persistence
- route `weekly_planning` into the unchanged Stable V5 turn application with the original text
- make `ambiguous` explicit and non-mutating
- fail explicitly on provider/schema failure; do not fall back to the removed parser
- persist the entry provider request, raw response, and validated decision in the first Stable V5 turn trace
- expand trace diagnostic request/response/validation capacity from two to three so entry + generic + repair are all retained

### Regression evidence

- `weeklyPlanningEntryRouter.test.ts`
- `weeklyPlanningEntryRouterArchitecture.test.ts`
- `NaturalLanguageAssistant.entryRouting.test.tsx`
- `weeklyPlanningStableV5RuntimeTraceLifecycle.test.ts`
- `weeklyPlanningStableV5TraceRuntimeDebugStages.test.ts`
- `weeklyPlanningSemanticPromptBudget.test.ts`

## Prompt inventory and Luna review

Measurements use UTF-8 serialized request bytes. Approximate tokens below are `ceil(bytes / 4)` and are comparison estimates, not provider billing tokens. The representative state is fixed to 2026-08-14 in `Asia/Tokyo`, selected week 2026-08-17 through 2026-08-23, with empty existing-plan/timetable collections.

- entry router: system 735 B, user 58 B, schema 262 B, whole request 1,237 B, about 310 tokens, completion cap 40
- generic semantic: system 5,002 B, user 744 B, schema 11,333 B, whole request 17,351 B, about 4,338 tokens, completion cap 3,200
- focused authorization: system 644 B, user 105 B, schema 260 B, whole request 1,202 B, about 301 tokens, completion cap 80
- focused contextual answer: system 1,244 B, user 203 B, schema 609 B, whole request 2,271 B, about 568 tokens, completion cap 140
- focused planning-window repair: system 361 B, user 189 B, schema 363 B, whole request 1,121 B, about 281 tokens, completion cap 120
- focused temporal-scope repair: system 391 B, user 225 B, schema 274 B, whole request 1,097 B, about 275 tokens, completion cap 60
- dialogue renderer: system 603 B, user 2,259 B, schema 426 B, whole request 3,513 B, about 879 tokens

There are no few-shot conversations in these current weekly-planning prompts. The generic semantic request is declarative policy plus current state and a strict schema. Provider/validation handling is: focused routes return fallback to generic when their meaning is not exact; generic semantic permits one repair; renderer falls back only to the deterministic reference response without changing application state; entry routing has no heuristic repair.

The repository also has a separate, ordinary single-plan suggestion pipeline in `src/services/naturalLanguagePlanner.ts`. It is not part of Stable V5, but it is included in the model-call inventory because the fresh-session router can hand a request to it.

- batch extraction: direct structured request, no purpose override, JSON-object extraction plus deterministic normalization/fallback to the original text
- planning-intent extraction: direct structured request, no purpose override, deterministic enum/date/time normalization and allocation after the call
- single-plan extraction: direct structured request, no purpose override, two compact few-shot lines, deterministic validation, and at most one second call with validator errors and the prior extraction

The isolated `weeklyPlanningBehaviorAwareDialoguePlanner.ts` contains another model call, but architecture tests prove that the legacy behavior-aware cluster is unreachable from production Stable V5. It remains inventory evidence rather than a production call to optimize in this branch. The ordinary single-plan prompts and schemas will receive the same byte/token/overlap table before the final gate; their raw-text helper rules must not be confused with Stable V5 Fact Graph truth.

The prior recorded generic real-API request was 23,014 B. The current representative request is 17,351 B, a reduction of 5,663 B or 24.6 percent. This reflects already-merged prompt cleanup and must not be attributed to Luna alone.

The new entry request adds 1,237 B only on fresh chat-mode classification and is 7.1 percent of the representative generic semantic request. It is not repeated on Stable V5 follow-up turns.

No additional generic semantic rule has been removed yet. A Luna ablation must compare the same scenario one element at a time and retain a deletion only if real-API output, validation/repair rate, conversation result, focused regressions, full tests, and build do not worsen.

## Reproducible observations

The resumable observation command is fixed to:

- clock: `2026-08-14T08:30:00.000Z` (`17:30` Asia/Tokyo)
- week starts on Monday
- selected week/start date: `2026-08-17`
- existing plans: empty for entry-routing turn
- timetable: empty for entry-routing turn
- external calendar: not configured, explicitly visible in scheduler source diagnostics
- conversation ID: `weekly-conversation-quality-entry-20260814-01`
- first input: `来週の勉強予定を立てたい`

Each later turn must restore the prior checkpoint artifact and submit exactly one human-selected utterance. The final full conversation will add fixed busy plans/timetable data and cover a short answer, ambiguity, correction, preferred-time change, one preview generation, no pre-approval save, and browser-visible promotion/approval controls.

## Required completion gate

- [ ] fresh-session Luna routing observation is accepted as `weekly_planning`
- [ ] each chosen dialogue turn is reviewed before the next turn
- [ ] Issue #118 remaining clarification-selection gap is either fixed and verified or recorded with concrete blocker evidence
- [ ] one-element Luna prompt ablation is recorded; no speculative deletion
- [x] focused tests green for work unit 1 (70 passed; existing skips/todos unchanged)
- [x] architecture tests green for work unit 1
- [x] typecheck green for work unit 1
- [x] full Vitest green for work unit 1 (333 files, 1,535 passed; 13 skipped, 5 todo)
- [x] production build green for work unit 1
- [ ] relevant Playwright browser regressions green
- [ ] final real-API conversation reaches one correct preview
- [ ] browser UI shows that preview and does not save before approval
- [ ] GitHub PR CI is green
- [ ] user review occurs before merge
