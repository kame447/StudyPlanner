# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-08-27

References:
- [Domain index](../README.md)
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
→ schema / evidence / reference validation
→ deterministic formal binding / canonical Fact Graph
→ deterministic proposal / repair / readiness / question / scheduler decision
→ AI dialogue renderer
→ preview
→ deterministic approval / save / persistence
```

There is no production semantic rollback path to a legacy parser/interpreter/runtime selector.

## Ownership

AI owns natural-language meaning and natural realization of typed dialogue decisions.

Deterministic application owns schema/evidence/reference validation, canonical IDs, binding, revision/idempotency, Fact Graph lifecycle, question/confirmation necessity, repair agenda, proposal lifecycle, readiness, scheduler/placement safety, preview freshness, approval/save, persistence/recovery and deterministic calculation.

After the semantic boundary, raw Japanese must not be reinterpreted by regex, keyword, dictionary or legacy parser as semantic truth.

## Semantic delta

AI output is a current-turn semantic delta, not an accepted-state snapshot. Past facts are not recopied without current evidence. Formal IDs, revision, lifecycle mutation and scheduler decisions are not AI-owned.

Provider failure, malformed output, validation failure or repair failure does not authorize legacy-parser fallback. Semantic repair is at most once where this contract permits it.

## Time semantics

Natural-language time meaning belongs to AI; calendar arithmetic and scheduler-facing temporal compilation belong to the deterministic application.

The request clock is distinct from UI `selectedDate`. New future-plan blocks must not be placed before the deterministic `notBefore` boundary.

A relative date can remain symbolic at the semantic boundary and be resolved deterministically from captured calendar context. Do not let renderer wording or current UI navigation become the source of date truth.

For accepted active date constraints used by movable-work placement, the application resolves supported date expressions and compiles task/component applicability into scheduler-facing absolute hard date bounds and preferred placements before downstream distribution/placement. Downstream placement consumes that compiled representation rather than independently re-resolving the same deadline / earliest-start / latest-end / preferred-window meaning from raw semantic facts. Task-level constraints may apply to component work; component-specific constraints must not leak to sibling components. Removed or superseded facts must not remain effective through a downstream re-read.

Unresolved or contradictory hard date constraints fail closed at scheduler-input compilation rather than being silently weakened.

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

## Repair agenda / dialogue progression

Not every uncertainty blocks the same boundary.

Deterministic application classifies what must be repaired now versus what can be deferred. A low-impact/non-blocking uncertainty may remain in a repair agenda while another required question is handled first, but deferred work must reopen before the boundary it can affect.

Defer/pass-over is not silent deletion of uncertainty and does not convert it into accepted fact.

See [Human Grounding Policy](../policies/human-grounding.md).

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

## Availability

Existing StudyPlanner plans and timetable are authoritative busy sources in current production. Accepted hard availability/life constraints and the request-time `notBefore` boundary reduce candidate space; preferences/personalization do not create free time.

Required-source failure is not equivalent to a successfully loaded empty source. Sleep end does not necessarily imply study-available start.

See [Availability Architecture](weekly-planning-availability-architecture-v5.md) and [Scheduling Policy](../policies/scheduling.md).

## Human grounding and memory

Application-only knowledge is not automatically shared ground. Current-week acceptance, durable preference and observed learning evidence are distinct states. One week-local acceptance is not promoted to a durable preference without the required scope/consent.

Authoritative app data may be used as grounded known context so the user can be asked for additions/deltas rather than forced to restate known facts. Renderer must not invent fields absent from that data.

## Preview / approval / save

Preview is unsaved and bound to owner, conversation, graph revision and source facts. A semantic change after preview requires a fresh preview. AI output alone cannot bypass approval/save.

Pending assumptions, deferred repair that still affects preview/save, stale source revisions or unaccepted proposals must not silently become saved truth.

## Persistence / trace / security

Persisted/session state is owner- and conversation-bound. Trace is diagnostic evidence, not authorization or planning truth. Untrusted stored strings remain data rather than instructions.

## Testing

Deterministic tests own deterministic invariants. Model-dependent semantic/dialogue behavior uses the real-API/human-review gate defined under `quality/`. Exact completed Japanese wording is not a universal oracle.

Version-independent safety scenarios are maintained in [regression-scenarios.md](../quality/regression-scenarios.md). Historical V4/task documents may supply evidence, but current guarantees must be expressed through current tests/contracts rather than relying on archive text alone.

## Execution ownership

Execution order is owned only by [the current roadmap](../roadmap/current.md). Do not duplicate the current queue in this contract.
