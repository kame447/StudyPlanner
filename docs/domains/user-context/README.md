# User Context

Status: canonical domain index
Updated: 2026-09-11
Owner Issue: #294

This domain owns app-wide durable user context, semantic / episodic memory, memory retrieval, lifecycle / forget behavior, and the decision of whether retrieved memory may be surfaced in conversation.

It does not replace the product domains that already own current structured state. Schedule, Timetable, Bookshelf / StudyMaterial, Actual, weekly-planning runtime state, and other current-value data remain authoritative in their own domains.

## Read order

1. [Memory and conversation architecture](architecture/memory-and-conversation.md)
2. [Memory lifecycle and surfacing policy](policies/memory-lifecycle-and-surfacing.md)
3. [Regression scenarios](quality/regression-scenarios.md)
4. [Current roadmap](roadmap/current.md)
5. Issue #294 for execution status and durable checkpoint

## Core boundary

User Context is not a second database for every long-lived product value.

```text
current structured state
= current truth owned by the relevant product domain

semantic / profile memory
= durable user-specific meaning without another current-state owner

episodic memory
= past conversation / event context with explicit provenance and time

working memory
= current interaction/session state
```

A memory item may help interpret or personalize a conversation, but it cannot silently override fresher authoritative product state.

## Responsibility map

- `architecture/`: memory kinds, ownership, identity/provenance, retrieval, conflict resolution, Surface Planner boundary, async consolidation, integration boundaries
- `policies/`: write/promotion rules, authority precedence, supersession, revoke/forget, relevance and surfacing behavior, retention/privacy behavior
- `quality/`: longitudinal, adversarial, cross-session, forget, stale-memory, surfacing and performance regression scenarios
- `roadmap/`: current execution order only

## Current state

The repository already contains a production foundation under `src/features/userPlanningContext/`, established by Issue #232 / PR #235. That foundation includes natural-language add/edit, authority/origin distinctions, source-of-truth routing, and revoked/tombstone behavior.

Issue #294 does not declare the complete architecture in this directory to be already shipped. Retrieval, episodic memory, temporal conflict resolution, Surface Planner behavior, consolidation/reflection, longitudinal evaluation, and complete end-to-end forget propagation remain planned implementation work unless current code/tests prove otherwise.

## Related owners

- Issue #47 owns weekly-planning personalization, outcome learning, and cloud conversation/session rollout. It consumes this domain rather than becoming the app-wide memory owner.
- Issue #164 owns client/local/cloud persistence, synchronization, migration, multi-tab and multi-device authority.
- Issue #152 owns stored/indirect prompt-injection and durable-context poisoning evaluation. User Context must not create a weaker parallel trust boundary.
- Issue #187 owns registered material metadata/current Bookshelf data. Mutable material progress is not duplicated into memory as current truth.
- Issue #246 owns learning consultation/advice lifecycle. AI-generated advice is not durable user truth merely because it exists in conversation state.
- The scheduling domain owns current scheduled-event authority and occurrence projection; Issue #278 established the completed `ScheduleEvent → ScheduleOccurrence` baseline.

## Historical foundation

Issue #232 and PR #235 remain implementation history for the current natural-language memory foundation. They do not replace this current domain index or the canonical documents above.
