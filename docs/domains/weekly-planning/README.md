# Weekly Planning

Status: canonical domain index
Updated: 2026-08-23

Stable V5 is the sole production weekly-planning runtime. This directory is the only current documentation root for weekly-planning responsibility.

## Read order

1. [Current contract](architecture/current-contract-v5.md)
2. [Product intent](spec/product-intent.md)
3. [Semantic ownership](architecture/weekly-planning-semantic-ownership-boundary-v5.md)
4. [Dialogue architecture](architecture/weekly-planning-dialogue-architecture-v5.md)
5. [Availability architecture](architecture/weekly-planning-availability-architecture-v5.md)
6. [Scheduling policy](policies/scheduling.md)
7. [Human grounding policy](policies/human-grounding.md)
8. [Test philosophy](quality/test-philosophy.md)
9. [Regression scenarios](quality/regression-scenarios.md)
10. [Current roadmap](roadmap/current.md)
11. [Active work](work/README.md)

## Supporting current references

These documents supplement the canonical owners above; they do not override them.

- [Semantic / orchestration direction](architecture/semantic-v5-direction.md)
- [Semantic schema reference](architecture/weekly-planning-semantic-schema-v5.md)
- [Conversation trace architecture](architecture/weekly-planning-conversation-trace.md)
- [Real-API evaluation policy](quality/real-api-eval-policy.md)
- [Personalization index](personalization/README.md)

## Responsibility map

- `spec/`: product intent and user-facing requirements
- `architecture/`: runtime/data/ownership invariants
- `policies/`: scheduling, conversation, grounding and learning policies
- `personalization/`: personalization-specific current index/design references
- `quality/`: deterministic, browser and real-model evaluation policy plus version-independent regression scenarios
- `roadmap/`: execution order and architecture direction
- `work/`: durable unfinished tasks/checkpoints for this domain

## Current state

- Stable V5 owns weekly-planning production semantics.
- AI interprets natural language and realizes typed dialogue; deterministic application code owns validation, lifecycle, repair/question/proposal decisions, scheduling, preview, approval and save.
- Current 7-day Stable V5 scheduling baseline uses six normal placement days plus a seventh reserve day; details live in `policies/scheduling.md` rather than historical task records.
- Request-time `notBefore`, authoritative busy sources, typed life constraints and work atomicity are current scheduling safety boundaries.
- Progress state (`scope_total` / `completed` / `remaining`) and the current planning `target` are distinct.
- Low-impact uncertainty may be deferred through the repair agenda while blocking information is resolved first; deferred issues must reopen before the boundary they affect.
- PR #162 established the dedicated `AiPlanningView`; Issue #52 still owns removal of remaining weekly-planning plumbing from generic QuickEntry.
- Issue #152 owns adversarial/prompt-injection evaluation.
- Trace privacy/recovery, personalization/cloud authority, multi-device approval uniqueness, saved-preview migration and AI-cost observability remain independent Issues.
- Client-first execution is a separate responsibility under [`../client-runtime/`](../client-runtime/README.md).

## Historical documents

A historical file, old `Status: active`, branch name or PR number never overrides this domain index or the current contract.

At the same time, moving a historical task/design to `docs/archive/` does **not** mean every concept inside it is obsolete. If current code/tests still enforce an invariant, that invariant must be represented in the current owning spec/architecture/policy/quality document before the historical record is treated as archive-only evidence.
