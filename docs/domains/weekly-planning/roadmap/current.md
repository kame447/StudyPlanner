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

Issue #152 remains a valid separate security scope.

- branch: `test/issue152-adversarial-validation-lab`
- Draft PR: #174
- the branch is intentionally long-lived, but its historical verification is not current-main evidence.

Issue #136 has reached its durable terminal point. PR #174 has since resumed on the existing security branch and has reconciled current main during that work. Because the branch remains active, re-fetch its latest Issue checkpoint, HEAD and verification state before relying on any result; do not treat older validation as current evidence. Continue attack → evidence → owning-layer classification → minimal fix → Real API/browser re-verification without absorbing #136 semantic-regression work or general UI QA into the security branch.

This security/provenance work is also an input to later #246 production consultation wiring and the applicable #305 Jev production rollout gates.

## Issue #305: bounded Jev integration

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) owns the initial OpenRouter focused-authorization implementation and subsequent evaluation. The detailed adapter boundary, failure handling, acceptance conditions and checkpoint remain in that Issue. The implementation defaults to off; the next operational step is an explicit real-API smoke, then non-authoritative shadow evaluation. Runtime code availability does not establish production enablement or calibrated quality.

The first release unit is a protected provider boundary plus the existing focused authorization route, initially off and then shadow-only. Offline fixtures, provider-boundary work and non-authoritative shadow preparation may proceed without waiting for future memory or consultation features. Preserve the #152 security priority and existing PR #174; before production canary, consume the applicable security/provenance regressions and Japanese evaluation evidence. Do not equate completion of Jev preparation with completion of #152, or require unrelated future security features as a blanket dependency.

After Japanese gold/holdout evaluation and calibration, enable only accepted eligible cases through a reversible canary. Low confidence, provider failure or mixed meaning must preserve the existing safe fallback and application authority. Numerical thresholds in the research are hypotheses to evaluate, not already-achieved guarantees or automatic rollout approval.

Only after the first gate passes should the same boundary expand to focused contextual categorical fields, then user-context owner routing and the #246 TurnPurpose consumer when its production integration is ready. These are ordered evaluation scopes, not instructions to pre-create one Issue, branch or PR per field. Keep free-value extraction and prose with the existing generative paths unless a later measured change is explicitly accepted.

The #246/#294 memory and consultation owners, #187 provider integration, #213 telemetry, #164 storage and #51 final approval retain their responsibilities. The limited consultation-agent work in PR #304 is separate from ordinary Stable V5 classification; neither integration replaces the other or becomes a new formal state authority.

## Issue #246: learning consultation before scheduling

Issue #246 adds pre-scheduling learning consultation/advice.

Canonical requirement:

- [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md)

Phase 1A pure foundation was completed and squash-merged by PR #280 as `214925dc9d6587f5412c24d7ed472f330dae9964`. The former `feat/issue-246-learning-consultation` branch is no longer active.

Implemented dormant foundation includes typed turn-purpose / active-interaction contracts, consultation state and immutable review/revision boundaries, strict answer validation, context availability/freshness fingerprinting, structured temporal normalization and promotion-coverage guards. Architecture tests keep this foundation detached from production runtime/provider/Firebase/scheduler/save/UI paths.

Production consultation is still not wired. When resumed, Issue #246 must consume existing owner contracts instead of recreating them:

- #269 planner-data availability — merged baseline
- #270 atomic formal-turn boundary — merged baseline
- #152 security/provenance — still active
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
