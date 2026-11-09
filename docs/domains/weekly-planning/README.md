# Weekly Planning

Status: canonical domain index
Updated: 2026-11-10

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
- [Issue #973](https://github.com/kame447/StudyPlanner/issues/973) is closed after [PR #974](https://github.com/kame447/StudyPlanner/pull/974) merged the examinee weekly actual-record conversation into main. A merge alone is not evidence that every production deployment is updated.
- [PR #970](https://github.com/kame447/StudyPlanner/pull/970) and [PR #971](https://github.com/kame447/StudyPlanner/pull/971) removed unused legacy planning/intake helpers without introducing a new production flow.
- AI interprets natural language and realizes typed dialogue; deterministic application code owns validation, lifecycle, repair/question/proposal decisions, scheduling, preview, approval and save.
- Issue #246 remains open for the complete learning consultation workflow. [PR #1082](https://github.com/kame447/StudyPlanner/pull/1082) and later slices introduced consultation replies, and [PR #1092](https://github.com/kame447/StudyPlanner/pull/1092) added advice presentation and adoption/rejection. The remaining conversion of adopted advice into typed planning constraints must not be represented as shipped. [The canonical consultation requirement](spec/learning-consultation-and-advice.md) still owns the full intended scope.
- Accepted active movable-work date constraints are resolved into scheduler-facing hard date bounds / preferred placements before downstream distribution and placement; downstream code must not become a second owner of the same temporal meaning.
- When the resulting planning horizon is exactly 7 days, Stable V5 uses six normal placement days plus a seventh reserve day. Applicable hard temporal bounds may require a longer fallback horizon; details live in `policies/scheduling.md` rather than historical task records.
- Request-time `notBefore`, authoritative busy sources, typed life constraints and work atomicity are current scheduling safety boundaries.
- Progress state (`scope_total` / `completed` / `remaining`) and the current planning `target` are distinct.
- Low-impact uncertainty may be deferred through the repair agenda while blocking information is resolved first; deferred issues must reopen before the boundary they affect.
- PR #162 established the dedicated `AiPlanningView`; Issue #52 was completed by PR #283. Generic QuickEntry no longer owns weekly-planning conversation, preview or approval plumbing.
- Issue #152 and Jev regression Issue #335 are closed historical baselines. Future semantic changes must satisfy current VNext and applicable security/quality contracts, not reopen the old Stable V5 rollout queue.
- Trace privacy Issue #45 is closed; trace recovery #89, personalization/cloud authority #47 and multi-device approval uniqueness #51 have separate owners. Saved-preview migration and AI-cost observability must be checked against their current Issues rather than inferred from this historical summary.
- Client-first execution is a separate responsibility under [`../client-runtime/`](../client-runtime/README.md).

[Issue #305](https://github.com/kame447/StudyPlanner/issues/305) is closed; its Jev integration and rollout decisions are historical evidence, not a standing implementation queue. [PR #332](https://github.com/kame447/StudyPlanner/pull/332) introduced the original default-off focused-authorization foundation. Whether any newer Jev behavior is enabled must be verified from current code and deployed configuration; this historical PR does not prove production activation. Semantic interpretation, consultation and approval/save retain their respective current owners.

[Issue #333](https://github.com/kame447/StudyPlanner/issues/333) owns the next Japanese evaluation work: reuse the existing Real Luna and Jev harnesses, compare the same cases and context, use Gemini only for first-pass review, and establish human-reviewed gold before canary. The existing 51 synthetic candidates are not gold. Execution ordering lives in [the roadmap](roadmap/current.md); integration and evaluation checkpoints remain in their respective Issues, and development/evaluation commands are maintained in [package.json](../../../package.json) and the scoped work/quality references rather than the root project overview.

## Historical documents

A historical file, old `Status: active`, branch name or PR number never overrides this domain index or the current contract.

At the same time, moving a historical task/design to `docs/archive/` does not mean every concept inside it is obsolete. If current code/tests still enforce an invariant, that invariant must be represented in the current owning spec/architecture/policy/quality document before the historical record is treated as archive-only evidence.

- [#305 top-1 contextual minutes / grounded ACK work](work/20261021-issue305-top1-ack.md)
