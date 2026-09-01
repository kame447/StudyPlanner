# 週間計画 roadmap

Status: canonical / execution order
Updated: 2026-09-02

Current contract: [../architecture/current-contract-v5.md](../architecture/current-contract-v5.md)
Learning consultation/advice requirement: [../spec/learning-consultation-and-advice.md](../spec/learning-consultation-and-advice.md)
Human grounding policy: [../policies/human-grounding.md](../policies/human-grounding.md)
Adaptive memory policy: [../policies/adaptive-memory.md](../policies/adaptive-memory.md)
Test philosophy: [../quality/test-philosophy.md](../quality/test-philosophy.md)
Active work: [../work/README.md](../work/README.md)

## Completed baseline

PR #109, #112, #113, #120, #127, #129, #130, #132, #140–#151, #154, #155 and #157 established Stable V5 production ownership, legacy semantic-runtime isolation, Fact lifecycle, scheduler/preview/approval boundaries and conversation-quality hardening.

PR #162 merged the primary UI and dedicated AI-planning surface without changing semantic ownership.

PR #166 merged cross-cutting browser, visual, accessibility, runtime and test-intelligence QA automation. It is infrastructure shared across the product rather than weekly-planning feature ownership.

PR #199 hardened preview-sheet interactions and scheduler date-bound behavior, including multiweek fallback horizons and hard date clipping for recurring and ordinary movable work.

PR #204 completed Issue #203 by centralizing accepted temporal-constraint resolution before scheduler placement. Active lifecycle, task/component applicability, resolved hard date bounds and preferred placements now have an explicit scheduler-facing compilation boundary instead of being independently re-derived by downstream placement paths.

PR #267 centralized recurring-plan mutation ownership, and PR #271 hardened cross-entity persistence so one user operation cannot expose a half-updated Plan / Actual / Todo state.

PR #272 completed Issue #270 by making the weekly-planning formal turn boundary atomic across conversation state and authoritative graph/context preparation. PR #274 completed Issue #269 by adding owner-scoped planner-data availability so unavailable/stale reads cannot be mistaken for authoritative empty data.

## Current priority: Issue #152

Attack the current boundary before adding more implementation: direct/stored prompt injection, durable-context poisoning, provenance, renderer integrity, nonsense/no-op, Unicode/delimiter and numerical/resource abuse.

```text
current main / contract refresh
→ threat case inventory
→ attack + evidence
→ owning layer classification
→ targeted deterministic regression
→ generalized fix
→ relevant Real API / browser verification
→ canonical docs sync
→ final CI / Browser Regression
→ Issue #152 close decision
```

## Issue #246: learning consultation before scheduling

Issue #246 adds a pre-scheduling consultation/advice capability: users can ask questions such as which material to use, in what sequence, and by what milestone date before concrete scheduling constraints are fixed.

Canonical requirement:

- [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md)

The implementation order for this scope is intentionally gated.

```text
research / comparable OSS review
→ canonical requirement and ownership boundary
→ cross-document consistency review
→ semantic representation / mixed-turn audit
→ consultation context contract
→ advice state/lifecycle contract
→ implementation
→ deterministic regressions
→ Real API Japanese evaluation
→ Browser Regression / E2E
→ canonical current-contract promotion
```

The documentation/architecture gate is closed. Phase 1A pure foundation is implemented in PR #280 as dormant domain code only: typed turn-purpose and active-interaction contracts, consultation state/revision/review boundaries, strict answer validation, source availability/freshness fingerprinting, structured temporal normalization, promotion-coverage checking, and deterministic/property regressions. The foundation has an architecture guard that forbids production weekly-planning runtime, provider, Firebase, scheduler, save, or UI imports from this directory. Merging Phase 1A therefore does not route any production turn into consultation and does not call an advice model.

The owner boundaries previously tracked by Issue #269 and Issue #270 are already merged on main. A later integration phase must consume the planner-data availability contract from PR #274 and the atomic formal-turn boundary from PR #272 rather than recreating them. Other owner-domain dependencies such as #152, #164, #187 and #51 remain outside #246 and must likewise be consumed instead of duplicated. Runtime routing, answer-provider execution, consultation persistence, live material/provenance resolution, promotion into Stable V5, scheduler/preview/Plan save, and UI wiring remain explicitly deferred after Phase 1A.

Do not implement consultation by adding prompt rules or raw-text routing outside the canonical requirement. A completed pure foundation does not make consultation a production guarantee; later runtime integration and verification are still required.

Implementation invariants:

- AI advice is advisory state, not user truth or schedule authorization.
- user consultation and assistant clarification are distinct concepts.
- StudyPlanner application remains the lifecycle/authority owner; answer AI is a specialist purpose, not a scheduler owner.
- Bookshelf / user context / timetable / schedule / actual/reporting remain their own sources of truth.
- explicit user adoption is required before advice can be promoted into normal Stable V5 planning contributions.
- accepted advice still passes readiness → scheduler → preview → approval → save.
- advice does not automatically become durable memory.
- stale / ambiguous advice fails safe.
- deterministic calculation remains application-owned truth.

This Issue is independent from Issue #152, but its implementation must consume the security/provenance rules established there rather than invent a weaker parallel boundary.

## Independent scopes

- Issue #52: remove remaining weekly-planning plumbing from generic QuickEntry; dedicated AI surface already exists.
- Issue #45/#89: trace privacy/lifecycle and production recovery.
- Issue #47: personalization/cloud authority rollout.
- Issue #51: multi-device approval uniqueness.
- Issue #128: saved-preview migration/compatibility.
- Issue #164: client-first execution, owned by the separate [client-runtime domain](../../client-runtime/README.md).
- Issue #246: pre-scheduling learning consultation/advice. Phase 1A is isolated foundation-only work in PR #280; production integration remains deferred and must consume the merged #269/#270 owner contracts plus the remaining owner-domain dependencies above.

## Architecture direction

One semantic/application decision has one owner. Renderer, compatibility and trace project upstream typed decisions instead of recomputing them. Prompt/file count is not the primary complexity measure; duplicated decision ownership is.

Issue #246 follows the same direction:

```text
language meaning → semantic layer
context/revision/lifecycle → application
learning strategy explanation → advice answer purpose
formal adoption/promotion → application
scheduling → existing scheduler
save authority → existing approval/save boundary
```

Do not solve consultation by introducing a second planning runtime or a monolithic agent that owns interpretation, recommendation, scheduling and persistence simultaneously.
