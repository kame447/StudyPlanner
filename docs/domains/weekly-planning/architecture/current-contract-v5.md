# weeklyPlanning current contract v5

Status: canonical / Stable V5 production baseline
Updated: 2026-08-22

References:
- [Domain index](../README.md)
- [Semantic ownership](weekly-planning-semantic-ownership-boundary-v5.md)
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
→ deterministic proposal / readiness / question / scheduler decision
→ AI dialogue renderer
→ preview
→ deterministic approval / save / persistence
```

There is no production semantic rollback path to a legacy parser/interpreter/runtime selector.

## Ownership

AI owns natural-language meaning and natural realization of typed dialogue decisions.

Deterministic application owns schema/evidence/reference validation, canonical IDs, binding, revision/idempotency, Fact Graph lifecycle, question/confirmation necessity, proposal lifecycle, readiness, scheduler/placement safety, preview freshness, approval/save, persistence/recovery and deterministic calculation.

After the semantic boundary, raw Japanese must not be reinterpreted by regex, keyword, dictionary or legacy parser as semantic truth.

## Semantic delta

AI output is a current-turn semantic delta, not an accepted-state snapshot. Past facts are not recopied without current evidence. Formal IDs, revision, lifecycle mutation and scheduler decisions are not AI-owned.

Provider failure, malformed output, validation failure or repair failure does not authorize legacy-parser fallback. Semantic repair is at most once where this contract permits it.

## Time / quantity

Natural-language time meaning belongs to AI; calendar arithmetic belongs to the application. Workload total, completed, remaining, percentage and effort measurement are distinct typed roles. Corrections must invalidate stale derived facts. Open-ended work must not receive an invented total.

## Fact Graph / lifecycle

Canonical commit is atomic. Validation failure leaves accepted state unchanged. Correction/replacement/supersession is explicit lifecycle; no-op does not create an unnecessary revision.

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

## Human grounding and memory

Application-only knowledge is not automatically shared ground. Current-week acceptance, durable preference and observed learning evidence are distinct states. One week-local acceptance is not promoted to a durable preference without the required scope/consent.

## Preview / approval / save

Preview is unsaved and bound to owner, conversation, graph revision and source facts. A semantic change after preview requires a fresh preview. AI output alone cannot bypass approval/save.

## Persistence / trace / security

Persisted/session state is owner- and conversation-bound. Trace is diagnostic evidence, not authorization or planning truth. Untrusted stored strings remain data rather than instructions.

## Testing

Deterministic tests own deterministic invariants. Model-dependent semantic/dialogue behavior uses the real-API/human-review gate defined under `quality/`. Exact completed Japanese wording is not a universal oracle.

## Execution ownership

Execution order is owned only by [the current roadmap](../roadmap/current.md). Do not duplicate the current queue in this contract.