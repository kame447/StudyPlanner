# 週間計画 roadmap

Status: canonical / execution order
Updated: 2026-10-07

Current contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Learning consultation/advice requirement: [../spec/learning-consultation-and-advice.md](../spec/learning-consultation-and-advice.md)
Human grounding policy: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory policy: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Active work: [../work/README.md](../work/README.md)

## Completed baseline

PR #109, #112, #113, #120, #127, #129, #130, #132, #140–#151, #154, #155 and #157 established Stable V5 production ownership, legacy semantic-runtime isolation, Fact lifecycle, scheduler/preview/approval boundaries and conversation-quality hardening.

PR #162 established the dedicated AI-planning surface. PR #166 established cross-product browser/visual/accessibility/runtime QA. PR #199 hardened preview interactions and date bounds. PR #204 completed Issue #203 temporal-constraint ownership centralization. PR #267/#271 hardened recurring and cross-entity mutation. PR #272 completed Issue #270 atomic formal turns. PR #274 completed Issue #269 planner-data availability.

Scheduling Issue #278 is complete. PR #279 unified `ScheduleOccurrence` reads across calendar/AI consumers and PR #282 moved scheduled persistence to canonical `ScheduleEvent`. Weekly planning must treat that scheduling-domain contract as current main baseline rather than reintroducing Plan/MonthEvent persistence ownership.

Issue #52 is complete. PR #283 removed the obsolete `WeeklyPlanningQuickEntryModal` compatibility wrapper, reduced generic `QuickEntryModal` to manual entry, and made `AiPlanningView` the user-facing owner for weekly-planning conversation, cancellation, preview and approval behavior. Generic QuickEntry must not regain weekly-planning state/callback plumbing.

## Completed: Issue #136 / PR #275

Issue #136 completed the Stable V5 semantic-regression path. PR #275 reconciled current main into `fix/issue136-semantic-regressions` by merge, carried the persisted Real Luna conversation to terminal save, and removed the temporary verification wiring it had added.

The completion-based evaluation reached `completed_saved` on reconciled code: preview, one user availability correction, regenerated preview, explicit approval, then 75 saved plans. Nothing was saved before approval.

Durable behavior established by this work:

- canonical weekday recurrence tokens are accepted by deterministic recurrence resolution while legacy aliases remain compatible.
- weekend `1日8時間` is represented as a 480-minute daily capacity, not invented full-day clock availability.
- a separate Saturday unavailable interval stays distinct from capacity.
- stale physics/chemistry work-breakdown uncertainties were removed without inventing problem counts or total effort; unresolved effort stays unresolved.
- a corrected availability supersedes the exact fact it replaces, and the correction records both endpoints explicitly rather than inferring them.
- a fact graph containing an availability correction survives persistence. The graph validator previously omitted availability declarations from the addressable correction targets, so such a conversation applied its correction in memory but could not be resumed from its saved form. Round-trip coverage now locks this.

The evaluation harness is driven by the dispatch workflow that already lives on main. Do not reintroduce branch-scoped push or pull_request triggers for it: a pull_request trigger spends a real API credential on every pull request touching weekly planning.

## Completed: Issue #152 adversarial security

[Issue #152](https://github.com/kame447/StudyPlanner/issues/152) is closed. PRs #323, #324, #326, #327, #329, #330 and #331 are merged into main and established the current security/provenance baseline: SHA-pinned dispatch-only evaluation, numeric bounds, durable user-context lifecycle, renderer integrity, typed channel provenance and decision binding.

Closed Draft PR #174 and `test/issue152-adversarial-validation-lab` are historical evaluation evidence only. Do not merge that branch or restart the completed replacement chain. Exact evaluation checkpoints and completion evidence remain in Issue #152 rather than becoming a second active queue here. PR #325 (fixed-clock e2e seeds, owner #322) is independent general QA.

Keep the durable security boundaries when building later #246 consultation wiring or #305 Jev integration. New Jev replacement units consume the affected regression gate through [Issue #335](https://github.com/kame447/StudyPlanner/issues/335); completion of #152 does not establish safety for those later changes. Branch-only semantic-quality rules, month-day planning windows and the retention suite were outside the merged chain and are not implicitly production requirements.

## Issues #305 / #333: bounded Jev integration and Japanese evaluation

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) owns integration and rollout. Its initial focused-authorization boundary and synthetic evaluation harness were merged through [PR #332](https://github.com/kame447/StudyPlanner/pull/332), with Jev disabled by default. The old implementation branch is completed history, not an active implementation queue. The earlier single-case real-API smoke proves connectivity only; it does not establish Japanese accuracy or authorize rollout.

The evaluation foundation from #333 (tuning / fixed-holdout execution, same-case Jev/Luna comparison, Luna responsibility inventory) was merged through PR #336. The first replacement wave under #305 has already been evaluated and merged as default-off capabilities or explicit no-go decisions; its 2026-09 work records are evidence, not a current implementation queue. Current execution is the candidate-set / Unit 0 / census / C5-D5 line tracked by Issue #305 and the active work index. Every new unit must verify the real Luna fallback for low confidence, abstention, unsupported cases and provider faults, calibrate on tuning only, evaluate a fresh sealed holdout once, compare with Luna alone on the same cases, and re-run the affected #335 regressions.

By owner decision on 2026-09-27, two-person human blind review is no longer a precondition. Difficult Japanese cases may be judged by a limited Opus 5.5 judge, recorded as `opus-5.5-limited-judge`; neither synthetic labels, Gemini judgments, the limited judge nor Jev/Luna agreement is human gold or ground truth. Before canary, each unit still needs tuning-only calibration and a sealed, unspent holdout with sample counts and uncertainty reported per case and per conversation group. Keep production `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` until an explicitly authorized canary; real-user shadow also requires the provider/privacy checks owned by #187 and tracked in #305. Runtime availability and a merged evaluation PR are not production activation. The #333 evaluation procedure lives in [`../work/20260926-issue333-japanese-semantic-evaluation.md`](../work/20260926-issue333-japanese-semantic-evaluation.md).

#152's current Stable V5 / Luna security fixes are merged and the Issue is closed. For each Jev replacement unit, [Issue #335](https://github.com/kame447/StudyPlanner/issues/335) re-runs the affected #152 regressions, including the Luna fallback path; it is a separate gate from #333's Japanese quality evidence, and neither substitutes for the other. Do not wait for unrelated future memory/consultation features before preparing evaluations.

Only after the first quality and safety gates pass should an explicitly authorized, reversible canary adopt accepted eligible cases. Low confidence and provider failures keep the existing LLM fallback; mixed meaning goes through the existing semantic handling rather than being partly applied. Focused authorization is the first replacement unit, not the permanent limit. The direction (#305) is to compare each semantic interpretation and decision Luna owns today, move the units that meet the quality and safety gates to Jev one at a time, and keep Luna for hard, uncertain, unsupported and failure cases. Candidate later units such as focused contextual categorical fields, user-context owner routing and #246 TurnPurpose are evaluation candidates, not instructions to create branches or migrate all fields now. Free-value extraction and prose stay with the generative paths unless a measured comparison shows otherwise; "theoretically replaceable" is not evidence. Approval, save, scheduling and state transitions stay with application code in every unit.

PR #466 completed per-purpose Jev rollout isolation with fail-closed defaults. That implementation record is historical and lives at [`../../../archive/work/closed/20261005-issue305-jev-purpose-rollout-isolation.md`](../../../archive/work/closed/20261005-issue305-jev-purpose-rollout-isolation.md). The merge did not activate Jev: production rollout remains governed by Issue #305, the current evaluation gates and explicit owner authorization.

The third-stage re-inventory (2026-09-28) found no further safe field-level or flat replacement. The next #305 direction is a new hypothesis recorded in [`../work/20261004-issue305-jev-hierarchical-input-interpretation.md`](../work/20261004-issue305-jev-hierarchical-input-interpretation.md): Jev selects only from application-owned candidate sets (complete transactions, a none escape to the existing whole-utterance Luna path, freshness revalidated before commit), using Jevbox `7e456212` as a reference implementation rather than a source of thresholds. The KPI is the semantic layer only (semantic-Luna-free rate, semantic Luna dispatches per turn, semantic latency, cost and correctness); renderer and final wording are out of scope, and the number of Jev fields is not a KPI. A unit is adopted only when it is measured to reduce semantic Luna dispatches safely under that record's pre-registered adoption gate; merging the foundation work (the focused contextual questionCode fix, turn-level semantic dispatch accounting/census, candidate-manifest primitives) is not adoption. Order: docs first, then the questionCode fix and census, then only candidates whose frequency and contract closure are established. Production stays `JEV_MODE=off` / `JEV_CANARY_PERCENT=0`; shadow and canary still need explicit owner approval.

The #246/#294 consultation and memory owners, #187 provider integration, #213 telemetry, #164 storage and #51 final approval retain their responsibilities. The limited consultation-agent work in PR #304 remains separate from ordinary Stable V5 classification. Keep #305 and #333 open until their own acceptance conditions are met.

## Issue #246: learning consultation before scheduling

Issue #246 adds pre-scheduling learning consultation/advice.

Canonical requirement:

- [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md)

Phase 1A pure foundation was completed and squash-merged by PR #280 as `214925dc9d6587f5412c24d7ed472f330dae9964`. The former `feat/issue-246-learning-consultation` branch is no longer active.

Implemented dormant foundation includes typed turn-purpose / active-interaction contracts, consultation state and immutable review/revision boundaries, strict answer validation, context availability/freshness fingerprinting, structured temporal normalization and promotion-coverage guards. Architecture tests keep this foundation detached from production runtime/provider/Firebase/scheduler/save/UI paths.

Production consultation is still not wired. When resumed, Issue #246 must consume existing owner contracts instead of recreating them:

- #269 planner-data availability — merged baseline
- #270 atomic formal-turn boundary — merged baseline
- #152 security/provenance — merged baseline; consume the established boundaries and applicable regression gates
- #164 storage/multi-client authority — separate owner
- #187 material identity/catalog — separate owner
- #51 final approval multi-device uniqueness — separate owner

Do not treat the completed foundation as a production guarantee and do not recreate the old branch merely because the Issue remains open.

## Independent scopes

- Issue #45/#89: trace privacy/lifecycle and production recovery.
- Issue #47: personalization/cloud authority rollout.
- Issue #51: multi-device approval uniqueness.
- Issue #128: saved-preview migration/compatibility.
- Issue #164: client-first execution, owned by the separate [client-runtime domain](../../client-runtime/README.md).
- Issue #246: learning consultation runtime integration after its owner dependencies are consumed.

## Architecture direction

One semantic/application decision has one owner. Renderer, compatibility and trace project upstream typed decisions instead of recomputing them. Prompt/file count is not the primary complexity measure; duplicated decision ownership is.
