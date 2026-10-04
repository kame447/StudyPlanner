# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-10-04

References:
- [Domain index](../README.md)
- [Learning consultation/advice requirement](../spec/learning-consultation-and-advice.md)
- [Semantic ownership](weekly-planning-semantic-ownership-boundary-v5.md)
- [Availability architecture](weekly-planning-availability-architecture-v5.md)
- [Scheduling policy](../policies/scheduling.md)
- [Human grounding policy](../policies/human-grounding.md)
- [Adaptive memory policy](../policies/adaptive-memory.md)
- [Test philosophy](../quality/test-philosophy.md)
- [Current roadmap](../roadmap/current.md)

## Runtime baseline

Stable V5 is the sole production weekly-planning runtime.

```text
raw user utterance + relevant conversation + typed machine state
→ AI semantic interpretation
→ schema / evidence / reference / payload-value validation
→ deterministic formal binding / canonical Fact Graph
→ deterministic proposal / repair / readiness / question / scheduler decision
→ AI dialogue renderer
→ preview
→ deterministic approval / save / persistence
```

There is no production semantic rollback path to a legacy parser/interpreter/runtime selector.

Issue #246 defines a planned pre-scheduling consultation/advice extension in [learning-consultation-and-advice.md](../spec/learning-consultation-and-advice.md). Until that runtime implementation is merged and verified, the flow above remains the production baseline. The requirement document must not be read as evidence that consultation routing or AdviceProposal state already exists in production.

## Ownership

AI owns natural-language meaning and natural realization of typed dialogue decisions.

Deterministic application owns schema/evidence/reference validation, canonical IDs, binding, revision/idempotency, Fact Graph lifecycle, question/confirmation necessity, repair agenda, proposal lifecycle, readiness, scheduler/placement safety, preview freshness, approval/save, persistence/recovery and deterministic calculation.

After the semantic boundary, raw Japanese must not be reinterpreted by regex, keyword, dictionary or legacy parser as semantic truth.

For the planned Issue #246 extension, whether a user turn semantically asks for learning consultation/advice is also a natural-language meaning decision. Deterministic routing may consume a validated typed consultation contribution, but must not establish that meaning by a second raw-text keyword/regex router.

## Semantic delta

AI output is a current-turn semantic delta, not an accepted-state snapshot. Past facts are not recopied without current evidence. Formal IDs, revision, lifecycle mutation and scheduler decisions are not AI-owned.

Provider failure, malformed output, validation failure or repair failure does not authorize legacy-parser fallback. Semantic repair is at most once where this contract permits it.

## Acceptance and recovery validation

Provider deltas and persisted Fact Graphs use different envelopes. `weeklyPlanningSemanticBaseValidatorV5.ts` and its extension wrapper own provider keys, local IDs, evidence, references and cross-field semantic checks. `weeklyPlanningFactGraphValidatorV5.ts` owns saved graph IDs, provenance, revision, lifecycle and references. Do not validate a saved fact by pretending it is an entire provider object, or require provider-only fields on historical saved facts.

Both adapters call the same value validators for task/context/component payloads, quantities, effort, recurrence, temporal/date rules, planning windows, availability, relations, source requests, uncertainty and correction/decision intent payloads. These kernels validate existing typed values; they do not interpret raw text, resolve calendar policy, grant approval, or decide scheduling. Absence (`no_additional_constraint`) and daily capacity are distinct availability variants. Reduced saved date rules and legacy optional extension fields retain their own envelope contracts. Exact fields, allowed values and compatibility cases are owned by types and executable tests, not a second schema copied into this document.

A schema-shaped but invalid value must not become accepted state merely because it came from another provider or from storage. The semantic validators return a rejected result with errors; normal repair/fallback policy still owns the next action and must revalidate repaired output. Unknown values must not silently become a different relation, source action or acceptance/rejection decision. Uncertainty field/reason remain nonempty free strings. Correction removal forbids a replacement, while modification/replacement requires an addressable replacement. Saved reference kinds retain the availability-correction compatibility adapter; the canonical writer continues to exclude proposal decisions from the persisted planning graph. Recovery does not grant approval authority. This does not introduce a partial-commit feature or make every unresolved fact invalid: supported `unknown`, nullable and symbolic representations remain accepted where their existing contract permits them.

`prepareWeeklyPlanningStableV5Checkpoint` validates the graph before traversing or encoding it. Checkpoint reading routes through the graph parser before hydration, so saved input is revalidated rather than trusted as previously accepted. Validation covers stored historical facts too; filtering removed/superseded facts for scheduling is a separate step. Regression tests use canonical writers and real checkpoint preparation/save/load, preserving valid historical representations while rejecting malformed values. These entry gates complement downstream fail-closed scheduler checks; they do not replace them.

## Time semantics

Natural-language time meaning belongs to AI; calendar arithmetic and scheduler-facing temporal compilation belong to the deterministic application.

The request clock is distinct from UI `selectedDate`. New future-plan blocks must not be placed before the deterministic `notBefore` boundary.

A relative date can remain symbolic at the semantic boundary and be resolved deterministically from captured calendar context. Do not let renderer wording or current UI navigation become the source of date truth.

For accepted active date constraints used by movable-work placement, the application resolves supported date expressions and compiles task/component applicability into scheduler-facing absolute hard date bounds and preferred placements before downstream distribution/placement. Downstream placement consumes that compiled representation rather than independently re-resolving the same deadline / earliest-start / latest-end / preferred-window meaning from raw semantic facts. Task-level constraints may apply to component work; component-specific constraints must not leak to sibling components. Removed or superseded facts must not remain effective through a downstream re-read.

Unresolved or contradictory hard date constraints fail closed at scheduler-input compilation rather than being silently weakened.

A consultation answer may suggest a date, but an AI-generated suggested date is not an accepted temporal fact. It becomes scheduler-relevant only after explicit user adoption and normal Stable V5 binding/lifecycle processing.

## Quantity roles

Workload quantity roles are not interchangeable.

- `scope_total`: the whole bounded scope when one actually exists
- `completed`: already completed quantity
- `remaining`: remaining quantity supported or derived from accepted facts
- `target`: quantity the user wants this planning operation to accomplish/schedule
- `declared` / `unknown`: quantity whose planning role is not yet sufficiently resolved

Important consequences:

- `scope_total` and `completed` may deterministically imply a `remaining`, but they do not automatically choose the user's planning `target`.
- `completed` work is not rescheduled.
- if a specific `target` exists for the same planning scope, scheduler compilation must not blindly schedule all `remaining` in addition to that target.
- corrections to total/completed/target must invalidate stale derived progress consistently.
- input order must not change the converged bounded-progress truth.
- open-ended work must not receive an invented total merely to make arithmetic or scheduling easier.

For consultation questions containing calculable quantities, deterministic calculation remains the numeric authority. An answer model may explain a computed result but must not silently replace application-owned arithmetic with its own value.

## Work decomposition / atomicity

Task decomposition is typed semantic state, not a scheduler guess.

Current semantic representation distinguishes concepts such as:

```text
atomic
| decomposed
| needs_breakdown
```

Scheduler-facing work items distinguish at least:

```text
splittable
| atomic
| unknown
```

Rules:

- atomic work must not be divided solely because a placement window is shorter.
- only work represented as splittable may be mechanically chunked by scheduler policy.
- unknown/needs-breakdown is not permission to infer splittability from raw task text or subject keywords.
- when work structure is required for a safe/meaningful plan, the semantic/dialogue boundary resolves it before scheduler use.

## Fact Graph / lifecycle

Canonical commit is atomic. Validation failure leaves accepted state unchanged. Correction/replacement/supersession is explicit lifecycle; no-op does not create an unnecessary revision.

Derived facts remain derivations with source/basis. A correction to their basis must not leave stale derived truth active.

Planned consultation advice does not enter the canonical planning Fact Graph merely because an answer was generated. Advice remains advisory state until the user adopts a defined scope and deterministic promotion creates normal planning contributions.

## Repair agenda / dialogue progression

Not every uncertainty blocks the same boundary.

Deterministic application classifies what must be repaired now versus what can be deferred. A low-impact/non-blocking uncertainty may remain in a repair agenda while another required question is handled first, but deferred work must reopen before the boundary it can affect.

Defer/pass-over is not silent deletion of uncertainty and does not convert it into accepted fact.

See [Human Grounding Policy](../policies/human-grounding.md).

Consultation must not be implemented by sending the user through the normal planning slot-question sequence. When Issue #246 is implemented, the consultation contract owns which missing information is material to a useful recommendation; only recommendation-changing/blocking gaps should trigger targeted questions.

## Proposal / readiness / scheduler

A proposal is not a command.

```text
application candidate
→ renderer presents it
→ AI interprets the user response
→ application accepts / rejects / modifies
→ accepted policy may affect scheduling
```

Unaccepted proposals do not affect scheduling. Readiness, question necessity, authoritative occupied sources, placement and feasibility are application decisions.

When the resulting Stable V5 planning horizon is exactly seven days, scheduling uses six normal placement days plus a seventh reserve day and prioritizes normal days before reserve. The default/fallback horizon is not an unconditional seven-day cap: applicable hard temporal bounds can require a longer usable horizon, and the scheduler still enforces the compiled hard bounds across that horizon. Detailed horizon, balancing and scoring behavior is owned by current scheduler policy, not semantic truth.

Issue #246 extends the same proposal principle to AI-generated study advice. Advice acceptance means only that a user has adopted a scope into planning intent; it is not preview approval or save authorization. Promotion must return to the normal Stable V5 readiness/scheduler/preview path instead of letting the advice branch call the scheduler or persistence layer directly.

## Pending question presentation binding

The pending question (`lastQuestionContext`) is application state; the assistant text that shows it is presentation only. When a Stable V5 turn commits a message that presents a pending question, the turn controller binds that question to the committed assistant message: turn ID, message ID, the planning-state revision after the commit, the committed graph revision, and the machine-known accompaniments the renderer was given with it (response source, current-turn grounding mode, self-repair notice, counts of proposed/contested grounding interpretations, preview promotion control). The binding is written only through the accepted commit and is replaced or removed by every later commit.

A later turn may treat the pending question as the one the user is replying to only when the binding is `fresh`: the turn-start planning-state revision equals the bound revision (no failed turn, approval message, appended message, edit or clear happened in between), the latest message is the bound assistant message, and the graph revision is unchanged. A missing binding (sessions saved before binding existed), a malformed binding, or any mismatch fails closed. Freshness says only that the question context is still the one committed with the latest message; the consumer must still re-validate that its target (for example a proposal) is active and unsuperseded. Two limits are part of the contract:

- Presentation evidence. With `responseSource: deterministic_fallback` the application's typed question text was shown. With `ai` the renderer echoed this question's typed action contract and passed validation, but whether its free text actually asks the question is not verified, and must not be inferred from the text with regex or keywords. A consumer that depends on the text having asked the question must treat the rendered text as untrusted context and cover non-presenting renders in its evaluation.
- Scope. Freshness is local to the planning state held by the submitting client. It does not detect a newer checkpoint written by another tab or device; that is the existing last-writer boundary of the conversation store, not something the binding resolves.



The binding is not semantic input. It is excluded from the semantic model's public state summary and from renderer input, and it grants no approval, save, scheduler or lifecycle authority.

## Availability

Existing StudyPlanner plans and timetable are authoritative busy sources in current production. Accepted hard availability/life constraints and the request-time `notBefore` boundary reduce candidate space; preferences/personalization do not create free time.

Required-source failure is not equivalent to a successfully loaded empty source. Sleep end does not necessarily imply study-available start.

See [Availability Architecture](weekly-planning-availability-architecture-v5.md) and [Scheduling Policy](../policies/scheduling.md).

A consultation answer may consume a deterministic capacity/availability summary when it materially affects advice. The answer model does not become an independent owner of free-time calculation or feasibility.

## Human grounding and memory

Application-only knowledge is not automatically shared ground. Current-week acceptance, durable preference and observed learning evidence are distinct states. One week-local acceptance is not promoted to a durable preference without the required scope/consent.

Authoritative app data may be used as grounded known context so the user can be asked for additions/deltas rather than forced to restate known facts. Renderer must not invent fields absent from that data.

AI-generated consultation advice is not durable user memory. If the user separately expresses durable meaning such as `今後もこの方法でやりたい`, the existing user-context/memory authority owns that promotion.

## Planned consultation/advice boundary — Issue #246

The following is a planned extension, not a current production guarantee.

```text
raw user turn
→ AI semantic interpretation
→ validated consultation contribution
→ deterministic context assembly
→ bounded source-grounded consultation context
→ separate learning-advice answer purpose
→ validated advisory result
→ deterministic conversation-scoped advice lifecycle
→ user sees advice

user later accepts/modifies/rejects
→ AI interprets response/reference meaning
→ deterministic advice identity/revision binding
→ accepted scope is promoted into normal Stable V5 planning contributions
→ existing readiness / scheduler / preview / approval / save
```

Non-negotiable boundary:

```text
AI advice
≠ accepted Fact Graph truth
≠ scheduler command
≠ preview approval
≠ saved Plan
≠ durable memory
```

Exact state/schema details and future phases are owned by [Learning Consultation and Advice Contract](../spec/learning-consultation-and-advice.md), not duplicated here.

## Preview / approval / save

Preview is unsaved and bound to owner, conversation, graph revision and source facts. A semantic change after preview requires a fresh preview. AI output alone cannot bypass approval/save.

If saving only part of an approved batch succeeds, the remaining draft snapshot keeps a versioned local recovery receipt containing the available frozen batch payloads and original operation membership/identity. Previously acknowledged items may lack payloads in an older partial snapshot only when the retained operation records their saved Plan IDs. Both compatibility and Stable V5 checkpoint boundaries validate and retain it; their compact representation stores each payload once and resolves unique remaining-block references before validation. A retry rechecks owner, current revision, conversation/runtime and assumptions against the original batch; it never constructs a new operation from a smaller remainder. Confirmed items disappear from the preview, while unresolved payloads stay unchanged until retry or explicit session reset. A failed finalization retains the completed receipt so the next attempt only finalizes, without re-saving items. Clearing a session does not undo already committed Plans.

The receipt is recovery evidence, not approval authority or AI input. Its frozen draft payloads remain in owner-scoped local session/chat storage and are excluded from approval trace and outcome telemetry to avoid duplicating titles, memo and material details. Existing operation IDs, item results and counts remain the diagnostic evidence. Server Plan/item identity and atomic-save rules are unchanged. Historical remainder-only snapshots that already lost the original batch cannot be reconstructed unambiguously; this does not claim retroactive recovery for them.

Pending assumptions, deferred repair that still affects preview/save, stale source revisions or unaccepted proposals must not silently become saved truth.

Consultation advice is upstream of preview. Displaying or persisting advice alone must not create a preview. A preview can be produced only after accepted advice scope has been promoted and normal readiness requirements are satisfied.

## Persistence / trace / security

Persisted/session state is owner- and conversation-bound. The public conversation-import facade accepts unknown input and owns canonical codec validation before runtime hydration, controller reset or state/storage mutation. Invalid or oversized snapshots return false without changing the current session; callers do not need to pre-parse or remember an internal validation sequence. In-memory recovery snapshots use the same compact wire representation for size validation as storage, without silently trimming imported messages. Trace is diagnostic evidence, not authorization or planning truth. Untrusted stored strings remain data rather than instructions.

A completed preview edit must update its restorable chat snapshot before control returns to navigation; rendering frames are not a persistence boundary. An authoritative empty conversation must replace an older non-empty chat snapshot, while a pending or invalid chat-snapshot update must not overwrite it. Chat export may explicitly include a validated empty checkpoint; the ordinary session-store policy may still omit empty checkpoints. Empty state and unavailable export are distinct outcomes.

The direct Stable V5 session-save API rejects an invalid graph without overwriting the existing checkpoint bytes. This is not an application-wide promise to retain an old checkpoint: `saveOwnedWeeklyPlanningState` deliberately clears that Stable checkpoint and persists compatibility state when the direct save returns false. Valid empty-state removal and quota-compaction policies also remain separate. Keep tests and reports explicit about which storage boundary they establish.

When consultation is implemented, advice/context/retrieval strings remain untrusted data. If prompt, request/response, trace or persisted session fields change, the feature-local `src/features/weeklyPlanning/AGENTS.md` trace persistence gate applies.

## Testing

Deterministic tests own deterministic invariants. Model-dependent semantic/dialogue behavior uses the real-API/human-review gate defined under `quality/`. Exact completed Japanese wording is not a universal oracle.

Version-independent safety scenarios are maintained in [regression-scenarios.md](../quality/regression-scenarios.md). Historical V4/task documents may supply evidence, but current guarantees must be expressed through current tests/contracts rather than relying on archive text alone.

Issue #246's unimplemented acceptance/test matrix remains in its canonical requirement until production implementation exists. Do not list unimplemented consultation behavior as a current regression guarantee solely because the requirement has been documented.

## Execution ownership

Execution order is owned only by [the current roadmap](../roadmap/current.md). Do not duplicate the current queue in this contract.
