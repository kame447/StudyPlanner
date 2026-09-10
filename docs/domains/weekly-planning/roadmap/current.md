# 週間計画 roadmap

Status: canonical / execution order
Updated: 2026-09-05

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

## Immediate active path: Issue #136 / PR #275

Issue #136 owns the active Stable V5 semantic-regression implementation path.

- Issue: #136 `P1: Real Luna completion-based E2E regression tracker`
- branch: `fix/issue136-semantic-regressions`
- Draft PR: #275

Exact branch HEAD, current-main divergence, Real Luna continuation state, verification evidence, and next action are owned by Issue #136 / PR #275. Re-fetch those mutable sources before resuming instead of copying their changing values into this roadmap.

Resume order remains:

```text
re-fetch Issue #136 / PR #275 / current main
→ reconcile current main into the existing branch when the active owner reaches that step
→ classify conflicts by owner; preserve #278 ScheduleEvent authority
→ rerun deterministic checks on the reconciled HEAD
→ continue the persisted Real Luna checkpoint
→ resolve remaining effort questions without inventing unknown quantities
→ reach preview
→ perform one correction
→ explicit approval
→ terminal save
→ remove temporary Real Luna workflow/command wiring
→ final CI / Browser Regression / diff audit
→ merge/close decision for #136
```

Known durable behavior already established in this work includes:

- canonical weekday recurrence tokens are accepted by deterministic recurrence resolution while legacy aliases remain compatible.
- weekend `1日8時間` is represented as a 480-minute daily capacity, not invented full-day clock availability.
- physics/chemistry stale work-breakdown uncertainties were removed without inventing problem counts or total effort.

## Next priority: Issue #152 adversarial security

Issue #152 remains a valid separate security scope.

- branch: `test/issue152-adversarial-validation-lab`
- Draft PR: #174
- the branch is intentionally long-lived, but its historical verification is not current-main evidence.

After #136 reaches a durable terminal point, reconcile PR #174 with current main before relying on it. Then continue attack → evidence → owning-layer classification → minimal fix → Real API/browser re-verification. Do not absorb #136 semantic-regression work or general UI QA into the security branch.

This security/provenance work is also an input to later #246 production consultation wiring.

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
