# Weekly Planning

Status: canonical domain index
Updated: 2026-11-04

VNext is the production weekly-planning conversation core. Stable V5 remains in source for local comparison and for pure responsibilities reused through the VNext boundary; it is not a production conversation fallback. This directory is the canonical documentation root for weekly planning.

## Read order

1. [VNext production conversation contract](architecture/vnext-conversation-core.md)
2. [Stable V5 contract (local comparison and reused pure logic)](architecture/current-contract-v5.md)
3. [Product intent](spec/product-intent.md)
4. [Learning consultation and advice](spec/learning-consultation-and-advice.md)
5. [Semantic ownership in V5](architecture/weekly-planning-semantic-ownership-boundary-v5.md)
6. [Dialogue architecture in V5](architecture/weekly-planning-dialogue-architecture-v5.md)
7. [Availability architecture in V5](architecture/weekly-planning-availability-architecture-v5.md)
8. [Scheduling policy](policies/scheduling.md)
9. [Human grounding policy](policies/human-grounding.md)
10. [Test philosophy](quality/test-philosophy.md)
11. [Regression scenarios](quality/regression-scenarios.md)
12. [Current roadmap](roadmap/current.md)
13. [Active work](work/README.md)

## Supporting current references

These documents supplement the canonical owners above; they do not override them.

The [VNext core contract](architecture/vnext-conversation-core.md) governs production conversation ownership, extensions and scale limits. [Issue #926](https://github.com/kame447/StudyPlanner/issues/926) was closed after production adoption via [PR #928](https://github.com/kame447/StudyPlanner/pull/928). Local V5 comparison requires `VITE_WEEKLY_PLANNING_CORE=stable_v5` on a development host. The VNext boundary continues to reuse V5 pure scheduling, preview, renderer and approval responsibilities.

- [Semantic / orchestration direction](architecture/semantic-v5-direction.md)
- [Semantic schema reference](architecture/weekly-planning-semantic-schema-v5.md)
- [Conversation trace architecture](architecture/weekly-planning-conversation-trace.md)
- [Real-API evaluation policy](quality/real-api-eval-policy.md)
- [Agent-guided browser E2E pilot](quality/agentic-browser-e2e.md)
- [Personalization index](personalization/README.md)

## Responsibility map

- `spec/`: product intent and user-facing requirements. `learning-consultation-and-advice.md` owns the planned Issue #246 consultation/advice extension.
- `architecture/`: runtime/data/ownership invariants
- `policies/`: scheduling, conversation, grounding and learning policies
- `personalization/`: personalization-specific current index/design references
- `quality/`: deterministic, browser and real-model evaluation policy plus version-independent regression scenarios
- `roadmap/`: execution order and architecture direction
- `work/`: durable unfinished tasks/checkpoints for this domain

## Current state

- VNext owns the production conversation state and interpretation-to-transaction flow. Stable V5 is retained for local comparison and reused pure responsibilities, not for production dialogue fallback.
- [Issue #973](https://github.com/kame447/StudyPlanner/issues/973) (examinee weekly actual-record conversation and regression E2E) is open; a Draft PR is not evidence of a shipped feature.
- [PR #970](https://github.com/kame447/StudyPlanner/pull/970) and [PR #971](https://github.com/kame447/StudyPlanner/pull/971) removed unused legacy planning/intake helpers without introducing a new production flow.
- AI interprets natural language and realizes typed dialogue; deterministic application code owns validation, lifecycle, repair/question/proposal decisions, scheduling, preview, approval and save.
- Issue #246 extends the product toward pre-scheduling learning consultation. Its dormant typed foundation was merged by PR #280, but production routing and advice execution are still pending; [the canonical consultation requirement](spec/learning-consultation-and-advice.md) must not be read as an already-shipped production guarantee. Advice enters normal planning only after explicit user adoption.
- Accepted active movable-work date constraints are resolved into scheduler-facing hard date bounds / preferred placements before downstream distribution and placement; downstream code must not become a second owner of the same temporal meaning.
- When the resulting planning horizon is exactly 7 days, Stable V5 uses six normal placement days plus a seventh reserve day. Applicable hard temporal bounds may require a longer fallback horizon; details live in `policies/scheduling.md` rather than historical task records.
- Request-time `notBefore`, authoritative busy sources, typed life constraints and work atomicity are current scheduling safety boundaries.
- Progress state (`scope_total` / `completed` / `remaining`) and the current planning `target` are distinct.
- Low-impact uncertainty may be deferred through the repair agenda while blocking information is resolved first; deferred issues must reopen before the boundary they affect.
- PR #162 established the dedicated `AiPlanningView`; Issue #52 was completed by PR #283. Generic QuickEntry no longer owns weekly-planning conversation, preview or approval plumbing.
- Issue #152 established the current Stable V5 adversarial/prompt-injection baseline and is closed. New Jev replacement units use Issue #335 for affected safety regressions.
- Trace privacy/recovery, personalization/cloud authority, multi-device approval uniqueness, saved-preview migration and AI-cost observability remain independent Issues.
- Client-first execution is a separate responsibility under [`../client-runtime/`](../client-runtime/README.md).

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) owns bounded Jev integration and rollout. [PR #332](https://github.com/kame447/StudyPlanner/pull/332) merged the server-side OpenRouter focused-authorization boundary and evaluation preparation into main with `JEV_MODE=off` / `JEV_CANARY_PERCENT=0`. Merging this foundation does not enable Jev for production decisions. The full semantic document, consultation and approval/save authority remain with their existing owners.

[Issue #333](https://github.com/kame447/StudyPlanner/issues/333) owns the next Japanese evaluation work: reuse the existing Real Luna and Jev harnesses, compare the same cases and context, use Gemini only for first-pass review, and establish human-reviewed gold before canary. The existing 51 synthetic candidates are not gold. Execution ordering lives in [the roadmap](roadmap/current.md); integration and evaluation checkpoints remain in their respective Issues, and development/evaluation commands are maintained in [package.json](../../../package.json) and the scoped work/quality references rather than the root project overview.

## Historical documents

A historical file, old `Status: active`, branch name or PR number never overrides this domain index or the current contract.

At the same time, moving a historical task/design to `docs/archive/` does not mean every concept inside it is obsolete. If current code/tests still enforce an invariant, that invariant must be represented in the current owning spec/architecture/policy/quality document before the historical record is treated as archive-only evidence.

- [#305 top-1 contextual minutes / grounded ACK work](work/20261021-issue305-top1-ack.md)
