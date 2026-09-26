# 週間計画 roadmap

Status: canonical / execution order
Updated: 2026-09-26

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

## Next priority: Issue #152 adversarial security

Issue #152 remains a valid separate security scope. Its adversarial evaluation and fixes were completed and independently audited on the integration branch `test/issue152-adversarial-validation-lab` (closed Draft PR #174, tested HEAD `b75ebabd`, audit CLOSE-READY). PR #174 is **superseded and kept as evidence only**: do not merge it, and do not treat it as the merge path.

The merge path is this replacement PR chain from main, in dependency order. Each PR targets `main`; dependent branches are built on their predecessor, and each PR states its review range:

1. #323 (merged): dispatch-only Issue #152 Real API workflow (SHA-pinned `ref`, step-scoped credential)
2. #324 (merged): numeric safety and planning-window year bound
3. #326: durable user-context lifecycle
4. #327: renderer integrity
5. #329: typed channel provenance, evidence matcher, trust-boundary prompt, Real harness and suites
6. #330: decision binding and the stored-durable suite
7. #331: remaining evidence pins

#325 (merged; fixed-clock e2e seeds, owner #322) is independent general QA, not part of #152.

Before each merge, re-fetch the PR's exact head and the latest Issue #152 checkpoint. PRs #329 and #330 need their Issue #152 Real suites ×3 at their exact SHA, which is possible only after #323 is on main. #152 closes only after the chain is merged and the final gate is terminal on the main SHA. The final gate is the six security suites (synthesized-evidence, stored-durable, renderer-influence, adversarial, indirect, stateful) plus a normal completed-save conversation. Branch-only semantic-quality rules, month-day planning windows and the retention suite are not part of this chain; they need a separate semantic owner if they are wanted.

This security/provenance work is also an input to later #246 production consultation wiring and the applicable #305 Jev production rollout gates.

## Issues #305 / #333: bounded Jev integration and Japanese evaluation

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) owns integration and rollout. Its initial focused-authorization boundary and synthetic evaluation harness were merged through [PR #332](https://github.com/kame447/StudyPlanner/pull/332), with Jev disabled by default. The old implementation branch is completed history, not an active implementation queue. The earlier single-case real-API smoke proves connectivity only; it does not establish Japanese accuracy or authorize rollout.

The next active work is [Issue #333](https://github.com/kame447/StudyPlanner/issues/333): separate tuning and fixed-holdout execution, preserve comparison evidence for failed Luna calls, compare Jev and the existing Luna path on the same cases/context, and add a minimal Gemini first-pass judge. Keep the existing 51 cases synthetic/unreviewed until human review. Reuse the completion-based Real Luna foundation from #136 / PR #144 / #145 rather than creating a second general evaluation framework. Current branch, agent ownership and exact verification checkpoints live in #333, not in this roadmap.

Before canary, #333 must supply human-reviewed gold, tuning-only question/threshold calibration and fixed-holdout results with sample counts and uncertainty. Gemini judgments and Jev/Luna agreement are not ground truth. Keep production `JEV_MODE=off` / `JEV_CANARY_PERCENT=0` during this comparison work; real-user shadow also requires the provider/privacy checks owned by #187 and tracked in #305. Runtime availability and a merged preparation PR are not production activation. The #333 evaluation procedure and human-review rules live in [`../work/20260926-issue333-japanese-semantic-evaluation.md`](../work/20260926-issue333-japanese-semantic-evaluation.md).

#152's current Stable V5 / Luna security fixes are merged and the Issue is closed. For each Jev replacement unit, [Issue #335](https://github.com/kame447/StudyPlanner/issues/335) re-runs the affected #152 regressions, including the Luna fallback path; it is a separate gate from #333's Japanese quality evidence, and neither substitutes for the other. Do not wait for unrelated future memory/consultation features before preparing evaluations.

Only after the first quality and safety gates pass should an explicitly authorized, reversible canary adopt accepted eligible cases. Low confidence and provider failures keep the existing LLM fallback; mixed meaning goes through the existing semantic handling rather than being partly applied. Focused authorization is the first replacement unit, not the permanent limit. The direction (#305) is to compare each semantic interpretation and decision Luna owns today, move the units that meet the quality and safety gates to Jev one at a time, and keep Luna for hard, uncertain, unsupported and failure cases. Candidate later units such as focused contextual categorical fields, user-context owner routing and #246 TurnPurpose are evaluation candidates, not instructions to create branches or migrate all fields now. Free-value extraction and prose stay with the generative paths unless a measured comparison shows otherwise; "theoretically replaceable" is not evidence. Approval, save, scheduling and state transitions stay with application code in every unit.

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
- #152 security/provenance — still active; merge path is the replacement PR chain listed above
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
