# User Context Memory Lifecycle and Surfacing Policy

Status: canonical policy
Updated: 2026-09-11
Owner Issue: #294

Parent architecture: [../architecture/memory-and-conversation.md](../architecture/memory-and-conversation.md)
Quality scenarios: [../quality/regression-scenarios.md](../quality/regression-scenarios.md)

## 1. Core rule

StudyPlanner must distinguish four separate questions:

```text
Was something observed?
Should it be stored?
May it be used now?
Should it be explicitly mentioned now?
```

A positive answer at one stage does not imply a positive answer at the next stage.

In particular:

```text
observed
≠ durable memory

stored
≠ current truth

retrieved
≠ safe to surface

surfaced once
≠ should be surfaced repeatedly
```

## 2. Evidence and authority precedence

When multiple sources concern the same current semantic target, use the strongest applicable evidence rather than the most recently retrieved prose.

The general precedence is:

```text
1. authoritative current Structured State from the owning product domain
2. explicit current user statement in the active interaction
3. durable user-confirmed semantic memory
4. durable directly user-stated semantic memory
5. accepted domain-specific durable meaning produced through an explicit promotion boundary
6. system-inferred / derived memory, only where policy allows it
7. historical episodic evidence
8. general heuristic / model prior
```

This ordering is about semantic authority, not retrieval ranking. An item may be highly relevant while still being too weak to overwrite a stronger source.

A user-confirmed memory cannot override an owning domain's fresher current value when that domain is specifically authoritative for the current fact. For example, a confirmed old statement about material progress remains historical once Bookshelf has a newer current progress value.

## 3. Durable write policy

Durable memory is allowed only when the meaning is reusable across interactions and does not belong as the current value of another product domain.

Good candidates include stable user-specific meaning such as a long-term preference or background context.

Poor candidates include:

- current material progress
- current scheduled-event time
- current timetable
- one-off planning acceptance
- temporary availability
- unresolved speculation
- assistant-generated advice
- a model inference phrased as if the user had said it

When another domain owns the value, route to that domain or retain only an explicitly historical episode if justified.

## 4. User-confirmed vs user-stated vs inferred

### User-confirmed

A user-confirmed item is explicitly added, edited, or confirmed by the user as information StudyPlanner may remember.

It has the strongest durable-memory authority for the same semantic target, subject to the current Structured State rule.

### User-stated

A user-stated item is extracted from something the user directly said in conversation.

Semantic extraction may be performed by AI, but the system must preserve that the evidence came from the user rather than from the model's own inference.

A user-stated item may be durable without an extra modal confirmation when the product contract permits low-friction automatic memory, but it must remain reviewable/revocable and must not exceed what the user actually stated.

### System-inferred

A system-inferred item is a hypothesis or derived tendency rather than a direct user statement.

It must never be silently upgraded into user-confirmed truth.

Depending on the feature, it may belong in personalization/observation rather than semantic memory. If stored in User Context at all, its lower authority and confidence must remain explicit.

## 5. Advice and assistant-generated content

Assistant-generated text is not user memory evidence.

```text
assistant recommendation
≠ user statement
≠ accepted planning rule
≠ durable preference
```

Example:

```text
assistant: 「単語は15分ずつ分けるのがおすすめです」
user: 「今回はそれで組んで」
→ current plan acceptance only

user: 「今後も単語は15分ずつにしたい」
→ durable user-stated memory candidate
```

The first interaction must not be reflected back later as `ユーザーは15分学習を好む` merely because the assistant originally suggested it.

Issue #246 owns advice proposal/adoption state before any separate durable-memory candidate exists.

## 6. Lifecycle states

Production naming may differ, but the lifecycle must be able to represent these meanings:

```text
active
needs_review
superseded
revoked
archived/historical
```

### active

Eligible for normal retrieval subject to scope, current-state conflict, and relevance.

### needs_review

The system cannot safely treat the item as current without confirmation. It may be shown in a dedicated review/control surface, but must not silently enter model context as current truth.

### superseded

A newer/stronger item owns the semantic target. The old item may remain for history/audit but is not normal current-context evidence.

### revoked

The user requested that StudyPlanner forget/remove the item from normal memory use. It is excluded from normal retrieval and model context.

A tombstone/identity guard may remain to prevent resurrection. Retaining such a guard does not permit sending the revoked content back to the model.

### archived/historical

The item may be retained as history when policy allows, but it is not an active current fact.

## 7. Replace and supersede policy

Correction must not produce uncontrolled duplicate truths.

When a new statement semantically updates an existing target, deterministic identity/authority logic chooses among:

```text
no-op
replace active representation
supersede old item
create separate scoped item
ask because the relation is ambiguous
```

AI may propose the semantic relationship, but it does not commit the transition.

The system must preserve old provenance where audit/history is required without allowing the old text to compete in current retrieval.

## 8. Expiration and stale meaning

Expiration is not equivalent to `false` and is not proof of an outcome.

If a time-bound memory expires, possible transitions include:

- historical/archive
- needs_review
- superseded by current Structured State
- removal according to retention policy

Do not invent what happened after the valid interval ended.

A goal deadline passing does not prove that the goal was achieved or failed.

## 9. Revoke and forget guarantee

User-visible forget/removal has a stronger contract than hiding an item in UI.

After revoke/forget, the item must be excluded from:

- normal active-memory listing
- normal retrieval candidates
- model context projection
- generated profile/summary projection
- embedding/vector search result eligibility
- response cache or retrieval cache where it could reappear
- future automatic extraction paths that would resurrect the same identity without new user evidence

Multi-device behavior must follow Issue #164. A stale device must not overwrite a newer revoke with an older active record.

If complete physical erasure is required by a separate privacy/account-deletion contract, that cleanup is additional to the semantic revoke guarantee. Semantic revoke must work even when a minimal tombstone is temporarily required for anti-resurrection consistency.

## 10. Retrieval eligibility policy

Before relevance ranking, reject or quarantine any candidate that fails mandatory eligibility.

Eligibility includes at least:

- correct user/owner
- allowed scope
- allowed lifecycle state
- not revoked
- not superseded for current-fact use
- temporally compatible with requested use
- no stronger current Structured State contradiction
- sensitivity/access policy satisfied

These are fail-closed gates.

Do not represent an ineligible memory as a low relevance score and hope that ranking pushes it down.

## 11. Surfacing policy

A memory may be used silently when it helps produce a better answer without requiring explicit acknowledgment.

Explicit callback is justified only when it materially improves grounding, continuity, trust, or disambiguation.

Examples where explicit callback may be useful:

- the user directly refers to a previous discussion
- an old preference materially changes the recommendation and acknowledging it clarifies why
- current evidence conflicts with a remembered value and confirmation is required
- the user asks what StudyPlanner remembers

Examples where silent use or ignore is normally better:

- the memory only affects minor wording or ordering
- the same fact was acknowledged recently
- repeating the callback adds no information
- the memory is sensitive and not necessary to say aloud
- relevance is weak/indirect

## 12. Surface modes

The application-level surface decision supports these semantic outcomes:

```text
ignore
use_silently
light_callback
explicit_callback
ask_due_to_uncertainty_or_conflict
```

`use_silently` means the memory may influence answer construction but the response should not claim or emphasize that the system remembers a prior event.

`light_callback` means a brief natural continuity cue is allowed.

`explicit_callback` means the prior fact/event itself is intentionally foregrounded.

`ask_due_to_uncertainty_or_conflict` means memory cannot safely resolve the current meaning and the user must re-ground it.

## 13. Repetition and callback control

The system must actively avoid recall spam.

Relevant signals include:

- last surfaced time
- number of recent surfaces
- whether the current user turn itself references the memory
- whether acknowledgment changed the answer
- whether the memory was already acknowledged in the active conversation

No fixed universal cooldown duration is canonical yet. Implementation must measure and evaluate a suitable policy rather than hard-coding a research guess as product truth.

Surface-history metadata does not become part of the user's semantic profile.

## 14. Creepy and sensitive recall

Correct recall can still be a bad product behavior.

A memory should not be explicitly surfaced merely because it is available. Sensitive or unexpectedly old information may be better ignored or silently used, depending on product policy and necessity.

The system should prefer the minimum disclosure needed for the current user goal.

Cross-scope/cross-user leakage is always a correctness/security failure, not a style issue.

## 15. Conflict policy

When memory conflicts with current evidence:

```text
current authoritative domain state
→ use current state

current user statement vs durable old memory
→ use current statement and consider supersession/update

same-authority durable items with unclear relation
→ do not guess; ask or mark needs_review

historical episode vs current semantic memory
→ keep episode historical; use current semantic item
```

The answer model should receive the resolved relation, not a bag of contradictory prose and an instruction to decide freely.

## 16. Summary/cache invalidation policy

Derived summaries, embeddings, and retrieval caches are projections.

When a source item is revoked, superseded, materially edited, or re-scoped, dependent projections must become invalid or be recomputed before they can reintroduce obsolete meaning.

A summary omission is recoverable because canonical item identity remains elsewhere. A summary must never be the only place where forget/supersession semantics exist.

## 17. Reflection policy

Reflection may derive lower-risk organization metadata from existing evidence, but it does not gain stronger authority than its sources.

Allowed examples:

- propose duplicate groups
- derive an episode summary with source references
- mark possible staleness for review
- calculate retrieval-quality metadata

Disallowed examples:

- infer a new stable preference and save it as user-confirmed
- infer that an expired goal succeeded
- turn assistant advice into user truth
- erase contradictory evidence because the model finds one narrative more coherent

## 18. Failure and fallback policy

Memory is an enhancement layer, not a prerequisite for core deterministic product safety.

If memory retrieval, embedding, reflection, or surfacing fails:

- do not fabricate missing memory
- do not reinterpret missing data as negative evidence
- preserve current Structured State
- allow non-memory conversation where safe
- do not change scheduler availability, approval, save, current progress, or other owner-domain truth

An unavailable memory source is not equivalent to an authoritative empty profile.

## 19. Security policy

Stored prose is always untrusted data.

Instructions embedded in remembered text do not gain system/developer/application authority on later turns.

User Context must maintain the Issue #152 trust boundary for:

- direct/stored prompt injection
- delimiter/role-confusion text
- malicious entity names
- poisoning through durable context
- future imported/external evidence

Memory extraction, summary, reranking, and realization prompts all inherit this data/instruction separation.

## 20. Privacy and retention policy

Store only information with a concrete product purpose.

Do not use `might be useful someday` as sufficient justification for durable retention.

Retention, account deletion, and cloud synchronization must align with the relevant repository privacy/storage owners. Where a retention duration is not yet decided, the roadmap must leave it as an explicit design gate rather than inventing a permanent default.

User-facing controls should make it possible to inspect and revoke durable semantic memory without exposing internal schema complexity.

## 21. Policy invariants

1. Current Structured State wins over stale memory for current values.
2. A current-session acceptance does not automatically become a durable preference.
3. Assistant advice does not become user memory evidence.
4. User-stated and system-inferred origins remain distinguishable.
5. Revoked memory is not eligible for normal retrieval or model context.
6. Superseded memory does not compete as current truth.
7. Retrieval eligibility/security is enforced before relevance ranking.
8. Retrieved memory does not have to be explicitly surfaced.
9. Repeated callback without conversational value is a quality failure.
10. Summary/cache cannot bypass revoke/supersession.
11. Reflection cannot create stronger facts than its evidence.
12. Memory failure cannot alter product-domain authority or fabricate state.
