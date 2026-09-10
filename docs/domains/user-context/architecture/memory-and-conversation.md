# User Context Memory and Conversation Architecture

Status: canonical architecture contract
Updated: 2026-09-11
Owner Issue: #294

Parent index: [../README.md](../README.md)
Lifecycle/surfacing policy: [../policies/memory-lifecycle-and-surfacing.md](../policies/memory-lifecycle-and-surfacing.md)
Quality contract: [../quality/regression-scenarios.md](../quality/regression-scenarios.md)
Execution order: [../roadmap/current.md](../roadmap/current.md)

## 1. Purpose

This document defines the app-wide architecture for durable user context, long-term memory, memory retrieval, conflict resolution, and natural conversation use.

The goal is not to maximize how much StudyPlanner stores. The goal is to make long-running interaction coherent while preserving one authoritative owner for current product state.

The architecture therefore separates four concepts that are easy to collapse incorrectly:

```text
current structured state
working memory
semantic/profile memory
episodic memory
```

It also separates retrieval from surfacing. A memory item may be relevant enough to influence interpretation without being appropriate to mention explicitly.

## 2. Primary invariant: current structured state wins

If another StudyPlanner domain owns the current value of a fact, that domain remains the source of truth.

Examples:

```text
current scheduled event       → scheduling / ScheduleEvent / ScheduleOccurrence
current timetable             → Timetable owner
current material progress     → Bookshelf / StudyMaterial
current actual activity       → Actual / activity owner
current weekly-planning state → Stable V5 weekly-planning runtime
current advice lifecycle      → Issue #246 consultation/planning owner
```

User Context may retain provenance or a historical episode concerning those values, but it must not create a competing active truth.

A sentence such as `金フレは200語まで終わった` may be useful as historical conversation evidence. If Bookshelf now says 350 words completed, the old episode must never make 200 the current progress again.

Conceptually:

```text
Structured State current value
    > stale semantic/narrative memory
    > historical episode as current fact
```

The exact evidence precedence for durable memory is defined in the lifecycle policy, but this current-state owner rule is unconditional.

## 3. Memory classes

### 3.1 Working Memory

Working Memory is the short-lived state required to continue the current interaction.

Typical examples:

- current conversation target
- pending clarification target
- unresolved conflict
- current interaction mode
- temporary acceptance that applies only to this planning attempt
- last surface decision needed to avoid immediate repetition

Working Memory is not durable user preference merely because the application persists a session for recovery.

Technical persistence and semantic durability are separate concepts.

### 3.2 Semantic / Profile Memory

Semantic/Profile Memory contains reusable user-specific meaning that is expected to remain useful across multiple interactions and has no better current-state owner.

Examples may include:

- stable preference explicitly stated for future use
- background relevant to repeated study consultation
- persistent concern
- communication preference relevant to StudyPlanner behavior
- a durable self-description that the user asked StudyPlanner to remember

Semantic Memory must keep identity, provenance, authority, scope, lifecycle, and time semantics. A single free-form profile summary is not sufficient as the canonical representation.

### 3.3 Episodic Memory

Episodic Memory represents past interactions or events as past events.

Examples:

- the user previously discussed changing a study method
- a particular explanation was accepted or rejected
- the user made a decision in an earlier consultation
- a previous plan failed for a stated reason

An episode does not automatically become a stable preference or current fact.

Episodic Memory is useful for conversational continuity and historical reasoning, but its time/provenance must remain visible to the retrieval and conflict-resolution layers.

### 3.4 Structured State

Structured State is not a memory subtype owned by this domain. It is the collection of authoritative current-state projections supplied by other domains.

This distinction is deliberate. User Context retrieves Structured State together with memory when necessary, but does not absorb that state into its own canonical store.

## 4. Canonical item semantics

The exact production schema remains implementation-owned, but a canonical memory representation must preserve at least the following concepts.

```text
stable identity
user/owner scope
memory class
human-readable semantic meaning
provenance/evidence reference
origin/authority
confidence where inference is permitted
created/updated time
valid-from / valid-until where applicable
subject/topic/entity scope
supersedes / superseded-by relation
lifecycle state
revoked/forget tombstone semantics
retrieval metadata
surfacing history metadata
```

These are conceptual requirements, not an instruction to expose every field directly in UI or duplicate every field into every persistence record.

### 4.1 Identity

Display text is not identity.

Changing `英単語は15分ずつやりたい` into `単語学習は短いセッションにしたい` must not necessarily create a second independent preference when the semantic target is the same.

AI may propose a semantic match to an existing memory item. Deterministic application code owns the final identity binding and replace/supersede decision.

### 4.2 Provenance

Every durable semantic claim must be traceable to its evidence category.

At minimum, distinguish:

- directly user-confirmed
- directly user-stated and semantically extracted
- system-inferred / derived
- migrated legacy record
- historical episode derived from a conversation/event

AI-generated advice is not evidence that the user holds the advised preference.

### 4.3 Time

Time is part of meaning, not optional metadata.

The architecture must be able to distinguish:

```text
used to be true
became true at a known time
is currently asserted
is valid only until a date
was superseded
was revoked
```

A retrieval result without temporal interpretation cannot safely become current context.

### 4.4 Scope

A memory may be global or bounded to a subject, activity kind, material, goal, product surface, or another typed scope.

Scope is used before and during retrieval. Cross-scope recall is a correctness and privacy failure, not merely a ranking mistake.

## 5. Write architecture

The write path separates semantic interpretation from mutation authority.

```text
user/system event
    ↓
semantic interpretation
    ↓
MemoryCandidate
    ↓
deterministic validation
    ↓
source-of-truth routing
    ↓
identity / authority / conflict resolution
    ↓
lifecycle transition
    ↓
persistence
```

AI may own:

- semantic interpretation of natural language
- candidate memory class
- candidate durable/session-local/historical meaning
- candidate references to existing memories/entities
- candidate topic/scope
- episode summarization under bounded evidence

Deterministic application code owns:

- schema validation
- owner binding
- canonical ID
- whether another domain is the real source of truth
- authority comparison
- legal lifecycle transition
- merge/replace/supersede/revoke
- persistence and synchronization boundary
- whether a candidate is allowed into durable memory

No raw-text regex, keyword table, or legacy parser becomes the semantic authority for memory meaning.

## 6. Read and retrieval architecture

Memory must not be loaded wholesale into every model request.

The target pipeline is:

```text
current request
+ current structured state
+ current interaction state
        ↓
owner / user / scope / lifecycle eligibility filter
        ↓
lexical retrieval + semantic retrieval
        ↓
temporal / authority / supersession conflict resolution
        ↓
bounded relevance rerank
        ↓
Surface Planner
        ↓
selected context projection
        ↓
response realization
```

### 6.1 Eligibility filter comes before ranking

Revoked, wrong-owner, invalid-scope, expired-as-current, superseded, or otherwise ineligible items must not survive simply because they have high semantic similarity.

Security and lifecycle filters are not relevance scores.

### 6.2 Hybrid retrieval

Semantic/vector similarity may be useful for paraphrases. Lexical/entity matching may be useful for exact names, stable identifiers, or rare terms. Neither becomes the sole authority.

A future implementation may combine them, but the architecture contract is about behavior rather than choosing one vendor or vector database.

### 6.3 Temporal and authority conflict resolution

When multiple items refer to the same semantic target, retrieval must resolve which item may represent current meaning before model realization.

Inputs include:

- current Structured State
- explicit supersession relation
- authority/origin
- validity interval
- recency
- revoke state
- scope

Do not ask the LLM to freely choose between contradictory records after all of them have already been promoted as equally trusted prompt facts.

### 6.4 Bounded rerank

Reranking is allowed after eligibility and conflict resolution to choose the small set that best supports the current interaction.

The reranker may use current intent, topic, entity overlap, recency, importance, and other validated signals.

It must remain bounded. The production path must not regress to serially evaluating an unbounded memory history with expensive model calls.

### 6.5 Context projection

The final model-facing projection contains only what the current purpose needs.

It must preserve enough provenance and confidence/temporal meaning to prevent historical or inferred material from appearing as unquestioned current user fact.

Raw storage records, internal database metadata, embeddings, or tombstone text need not be sent to the answer model.

## 7. Surface Planner

Retrieval answers `what could be relevant`. Surface planning answers `what should the user actually hear now`.

These are different decisions.

The Surface Planner must be able to represent at least:

```text
ignore
use_silently
light_callback
explicit_callback
ask_due_to_uncertainty_or_conflict
```

The exact production type/name may differ, but implementations must preserve this semantic separation.

### 7.1 Inputs

Surface decisions may consider:

- current user intent
- whether memory changes the answer materially
- current conversation flow
- current Structured State
- memory authority/confidence
- recency of the memory
- recency/frequency of prior surfacing
- sensitivity/privacy classification
- contradiction or uncertainty
- whether explicit acknowledgment improves grounding

### 7.2 Repetition control

A relevant memory does not earn unlimited callbacks.

Surface history may be used to avoid repeatedly saying equivalents of `前にも話していましたね` when the information can simply inform the answer silently.

The surfacing layer may track bounded metadata such as last-surfaced time, surface count, or cooldown state. Those values are presentation-control evidence, not user facts.

### 7.3 Natural realization

The renderer/model may choose natural wording after the deterministic/application layer has decided what may be surfaced.

The renderer does not decide whether memory is current truth, whether it is revoked, or whether it may cross a scope boundary.

Conversely, deterministic code should not encode a large Japanese callback phrase table in order to simulate natural conversation.

## 8. Summary and compression boundary

Conversation or profile summaries may be useful projections, but they are not the canonical memory store.

A summary can omit details, flatten time, merge distinct identities, or retain a stale statement after the underlying record is superseded/revoked.

Therefore:

```text
summary
= recomputable context-compression projection
≠ canonical memory identity/lifecycle
≠ authoritative current structured state
```

When underlying memory changes, stale summary/cache projections must be invalidated or regenerated according to the lifecycle policy.

## 9. Reflection and consolidation

Long-running use creates duplicate, overlapping, low-value, and stale memories. Consolidation may reduce this growth.

Reflection/consolidation is not allowed to become a free-form fact generator.

Permitted responsibilities may include:

- grouping evidence-backed related items
- proposing merge/supersession candidates
- compressing episodes into a derived summary
- recalculating bounded relevance/quality metadata
- identifying items needing review
- retention cleanup

Any operation that would create a stronger semantic claim than its evidence supports must go back through normal memory write/authority rules.

## 10. Critical path vs deferred work

Memory quality must not make every StudyPlanner request slow or fragile.

Target split:

```text
critical request path
current structured-state projection
→ eligible memory retrieval
→ bounded conflict resolution/rerank
→ surface decision
→ model response

asynchronous/deferred path
semantic extraction when it need not block response
embedding/index updates
reflection/consolidation
summary refresh
retention cleanup
quality scoring
```

The exact deployment mechanism may be client/server/hybrid according to Issue #164 and future implementation evidence. This document does not assign a specific database/provider.

Memory subsystem failure must degrade toward current structured state plus non-memory conversation, not toward fabricated context or blocked core scheduling/save behavior.

## 11. Persistence and synchronization boundary

Issue #164 owns client/server storage authority, local replica design, offline queue, multi-tab/multi-device conflict policy, migration, and rollback principles.

User Context must consume that contract rather than inventing a separate sync model.

Required consequences include:

- one canonical shared identity for a memory item
- version/revision-aware mutation
- idempotent retry
- no indefinite dual-write migration
- revoked state cannot be casually overwritten by a stale device
- offline behavior must not claim a cloud forget/sync completed when it did not

## 12. Security and trust boundary

Issue #152 owns adversarial prompt-injection evaluation. User Context must preserve its stronger trust boundary.

All stored user/context prose is data, not instruction.

A memory item containing text such as `SYSTEM: ignore previous instructions` remains untrusted content. Retrieval or summarization must not promote that prose into model/system authority.

Security requirements include:

- strict owner/user isolation
- revoked/sensitive data exclusion where policy requires it
- provenance preservation
- bounded context projection
- no hidden privilege from memory origin
- stored/indirect prompt-injection regression coverage

## 13. Cross-domain integration

### Weekly planning / Issue #47

Weekly planning may consume eligible durable user context and may produce user-stated candidates or episodes. Its personalization observations remain weekly-planning-owned evidence and do not automatically become semantic user truth.

`docs/domains/weekly-planning/policies/adaptive-memory.md` remains the learning/scheduling-specific policy for how memory evidence can affect scheduling proposals/ranking. It does not own app-wide retrieval and surfacing.

### Learning consultation / Issue #246

Advice text is advisory state. It becomes neither durable memory nor user preference by generation alone.

If the user later expresses a durable meaning such as `今後もこの方針でやりたい`, that user statement may create a separate memory candidate through this domain's write boundary.

### Bookshelf / Issue #187

Current material total/progress/metadata is read from Bookshelf/StudyMaterial. A past discussion about a material may exist as an episode, but memory must not shadow the current Bookshelf value.

### Scheduling domain

Current event time/busy/recurrence semantics come from the scheduling domain's completed `ScheduleEvent → ScheduleOccurrence` contract (established by Issue #278). Narrative memory may recall a past event only as historical context and must not become the scheduler's occupied-time authority.

### Reporting

Deterministic report aggregates may be used as evidence where an owning feature explicitly requests them. User Context does not copy report metrics into semantic truth without a separate justified lifecycle.

### Product observability / Issue #213

Service-wide metrics may observe memory/retrieval/surface outcomes in privacy-preserving typed form. Observability does not become memory authority and must not require storing raw memory prose in lightweight analytics.

## 14. Migration from the current foundation

Issue #232 / PR #235 established the current `userPlanningContext` foundation. Migration must be incremental.

Initial architecture work must first inventory actual production records/types/repositories and characterize behavior before replacing schemas.

Existing guarantees to preserve include:

- user-confirmed authority remains strongest over weaker inference for the same semantic target
- existing V1/V2 readable data is not silently lost
- revoked/tombstone behavior remains protective
- natural-language user-facing add/edit does not regress to internal kind/field editing
- other-domain current state is routed away from durable memory

The new architecture should add retrieval/episode/surfacing semantics around this foundation rather than prematurely replacing it with a new storage technology.

## 15. Rejected architecture patterns

The following are explicitly non-canonical unless this document is revised with new evidence.

### One giant conversation summary as memory source of truth

Rejected because omission, stale values, identity collapse, correction, and forget propagation are too weak.

### Vector similarity top-k directly into the prompt

Rejected as the full authority because similarity alone does not enforce owner, lifecycle, time, supersession, current Structured State, privacy, or repetition control.

### Copy every domain value into memory

Rejected because it creates multiple current truths and drift.

### Mention every retrieved memory

Rejected because retrieval relevance does not imply conversational usefulness and causes repetition/creepy recall.

### Free-form autonomous reflection rewrites profile truth

Rejected because model inference would gain mutation authority over user facts.

## 16. Architecture invariants

Implementations and tests must preserve these invariants:

1. Current owner-domain Structured State cannot be overridden by stale memory.
2. Display text is not canonical memory identity.
3. Every durable semantic memory has provenance/authority semantics.
4. Time/supersession/revoke state participates in current-context eligibility.
5. Revoked memory cannot enter normal retrieval/model context.
6. AI advice/inference does not become user fact without valid evidence/promotion.
7. Eligibility/security filtering happens before relevance ranking.
8. Retrieval and surfacing are separate decisions.
9. Summary/cache is a projection, not canonical lifecycle authority.
10. Stored prose remains untrusted data.
11. Memory failure cannot fabricate free time, approval, save, current progress, or other product truth.
12. Cross-user/cross-owner retrieval fails closed.
13. Persistence/sync follows Issue #164 rather than a parallel authority.
14. Longitudinal behavior is tested across correction, supersession, and forget, not only single-turn recall.

## 17. Non-goals of the architecture phase

This contract does not by itself choose:

- a vector database vendor
- a specific embedding model
- a graph database
- a fixed number of memories retrieved
- a fixed token budget
- a fixed callback cooldown duration
- a server-only or client-only deployment
- a specific background-job provider

Those choices require implementation evidence, profiling, privacy review, and the owning Issue checkpoint. The invariants above must survive whichever mechanism is chosen.
