# User Context Current Roadmap

Status: canonical current execution order
Updated: 2026-09-08
Owner Issue: #294

Architecture: [../architecture/memory-and-conversation.md](../architecture/memory-and-conversation.md)
Policy: [../policies/memory-lifecycle-and-surfacing.md](../policies/memory-lifecycle-and-surfacing.md)
Quality: [../quality/regression-scenarios.md](../quality/regression-scenarios.md)

## Current phase

Phase 0 — canonical architecture and baseline audit.

The current documentation branch is documentation-only. It must not change production memory behavior, storage schema, provider choice, or weekly-planning runtime behavior.

After the canonical documentation is merged, implementation continues under Issue #294 one reviewable release unit at a time. Keep at most one active implementation branch/PR for the same logical #294 phase unless a genuinely separate child Issue is intentionally created with a distinct owner and acceptance boundary.

## Execution principles

Implementation order is evidence-driven:

```text
inspect current foundation
→ characterize existing guarantees
→ introduce one ownership boundary
→ verify
→ migrate consumers/producers
→ verify longitudinal behavior
```

Do not begin by replacing the current repository with a new vector database or rewriting the entire userPlanningContext schema.

Do not treat the target architecture as an already-shipped production guarantee until code/tests prove each phase.

## Phase 0 — canonical design and baseline audit

Goal: establish one current owner and determine exactly what exists today.

Required work:

- establish `docs/domains/user-context/` as the app-wide current documentation owner
- inspect current `src/features/userPlanningContext/` types, repositories, application flow, UI, Firestore/local behavior, migrations and tests
- map which Issue #232 / PR #235 guarantees are actually production-enforced
- inventory all producers of durable user context
- inventory all consumers that currently receive full active memory/context
- inventory summary/public-state/context projections that may duplicate memory meaning
- identify current deletion/revoke propagation and stale-device behavior
- establish a baseline longitudinal/adversarial corpus before adding new retrieval behavior
- profile current context size and AI request path when user context is present

Exit gate:

- current code/tests and target architecture are compared explicitly
- no undocumented current invariant is lost
- next implementation unit has a narrow responsibility and characterization tests

## Phase 1 — identity, provenance and lifecycle foundation

Goal: make memory identity/lifecycle robust enough for retrieval and correction.

Required capabilities:

- stable identity independent of display wording
- explicit provenance/origin/authority semantics
- scope representation
- time/validity semantics where applicable
- deterministic replace/supersede/revoke transitions
- anti-resurrection behavior
- idempotent mutation/retry
- compatibility/migration for current records

Dependencies:

- Issue #164 for storage/sync/migration authority
- Issue #152 for durable-context trust boundary

Exit gate:

- correction does not create competing active truths
- revoke survives reload and applicable concurrency tests
- current V1/V2 data remains safely readable/migratable

## Phase 2 — episodic memory and bounded retrieval

Goal: support long-term conversation continuity without loading all history.

Required capabilities:

- bounded episodic representation with provenance/time
- owner/scope/lifecycle eligibility filter
- lexical/entity retrieval for exact identifiers
- semantic retrieval for paraphrases
- bounded candidate set
- explicit distinction between retrieval unavailable and authoritative empty

Do not yet require explicit callback behavior. Retrieval can be integrated behind a diagnostic/evaluation boundary first.

Exit gate:

- longitudinal corpus can retrieve relevant past context across sessions
- revoked/wrong-scope/wrong-owner items fail eligibility regardless of similarity
- context size does not scale with all stored history

## Phase 3 — temporal conflict resolution and rerank

Goal: make retrieval safe when multiple memories or current domain data disagree.

Required capabilities:

- current Structured State precedence
- supersession resolution
- authority/origin comparison
- validity/time-aware interpretation
- conflict classification
- bounded reranking after eligibility resolution
- model-facing context projection that preserves current/historical/inferred distinctions

Exit gate:

- old material progress/schedule/preferences cannot shadow fresher owner-domain state
- answer model does not receive unresolved contradictory records as equal current facts when deterministic evidence can resolve them

## Phase 4 — Surface Planner and natural realization

Goal: make remembering feel natural rather than repetitive.

Required capabilities:

```text
ignore
use_silently
light_callback
explicit_callback
ask_due_to_uncertainty_or_conflict
```

Implementation must:

- separate retrieval result from surfacing decision
- use surface history/repetition evidence without turning it into user truth
- support silent use
- permit natural model wording after the application allows a callback
- avoid parsing rendered prose back into memory state
- evaluate sensitive/creepy/irrelevant callback failures

Exit gate:

- relevant memory can improve an answer without mandatory acknowledgment
- repeated adjacent callbacks are suppressed
- explicit callback occurs when it materially improves grounding
- uncertainty/conflict can route to confirmation instead of silent rewrite

## Phase 5 — consolidation, reflection and retention

Goal: control memory growth without granting reflection authority over truth.

Required capabilities:

- duplicate/near-duplicate candidate grouping
- episode compression with evidence references
- stale/review candidate generation
- projection/summary refresh
- retention cleanup according to an explicit policy
- index/cache invalidation on source changes

Keep this work out of the critical request path where possible.

Exit gate:

- reflection cannot produce a stronger claim than its evidence
- summaries remain recomputable projections
- revoked/superseded content cannot return through stale summaries/indexes

## Phase 6 — user control, privacy and end-to-end forget

Goal: make the product guarantee visible and testable to users.

Required capabilities:

- inspect durable memory in human-readable form
- edit/correct without exposing internal schema complexity
- revoke/forget with clear user-facing state
- safe error UX when sync fails
- applicable desktop/mobile responsive behavior
- end-to-end invalidation of retrieval/summary/cache/index projections
- multi-device/offline behavior aligned with Issue #164
- account deletion/retention integration where owned elsewhere

Exit gate:

- a user can understand what is remembered and change/remove it
- UI removal and semantic/runtime forget cannot drift
- stale device/reload does not resurrect forgotten information

## Phase 7 — longitudinal evaluation and production observability

Goal: prove the system remains correct over time rather than only in isolated tests.

Required work:

- run canonical multi-session corpus
- measure factual precision/currentness
- measure retrieval miss/false recall/stale recall separately
- measure callback repetition/irrelevant surfacing
- verify revoke/forget guarantee
- verify stored-injection resistance with Issue #152
- measure context/request size and latency
- emit privacy-preserving typed outcomes for product observability where useful
- inspect production failures without making observability the memory authority

Issue #213 owns service-wide telemetry/read-model design.

Exit gate:

- production path passes longitudinal, adversarial and user-control gates
- memory remains bounded and failure-isolated
- no known parallel source of truth remains

## Dependency map

### Issue #47

Owns weekly-planning personalization, cloud conversation/session rollout, and outcome learning. Consume User Context as an app-wide service/boundary rather than duplicating its retrieval/surfacing rules inside weekly planning.

### Issue #164

Owns local/cloud authority, offline queue, multi-tab/multi-device conflict, migration and rollback. Any memory persistence change must align before production rollout.

### Issue #152

Owns adversarial stored/indirect injection evaluation. Memory retrieval/summarization/realization must use the same or stronger trust boundary.

### Issue #187

Owns current Bookshelf/material information. User Context consumes current material state rather than copying mutable progress as durable truth.

### Issue #246

Owns consultation/advice lifecycle. Advice generation/adoption must remain distinct from durable-memory promotion.

### Issue #278

Owns current scheduled-event authority. Memory cannot become an occupied-time/current-event source.

### Issue #213

Owns service-wide product observability. Memory-quality metrics are projections/observations, not authority.

## Phase sequencing constraints

Do not implement Phase 4 Surface Planner on top of an unbounded/unfiltered retrieval path.

Do not implement autonomous consolidation before identity/provenance/supersession are strong enough to prevent accidental truth rewriting.

Do not claim forget is complete until source record, retrieval eligibility, derived projections, and applicable sync behavior are all verified.

Do not add production embeddings/vector search merely to satisfy the architecture diagram; first characterize the simplest retrieval baseline and prove a semantic retrieval need with evaluation evidence.

## Current checkpoint — 2026-09-08

Owner Issue: #294

Documentation branch:

`docs/issue-294-user-context-architecture`

Initial audited base:

`d4126511a6f5cb1c7a1c734498062ef2ec9f91a6`

Current activity:

- establish canonical domain docs
- synchronize documentation dictionary/navigation
- open one documentation PR
- no production runtime implementation in this phase

Next implementation action after documentation merge:

Perform the Phase 0 current-foundation inventory against the then-current `main`, create characterization evidence, and select the smallest Phase 1 release unit. Do not resume from the documentation branch for production implementation.
