# weeklyPlanning dialogue architecture v5

Status: canonical supplement / Stable V5
Updated: 2026-08-22

Parent contract: [current-contract-v5.md](current-contract-v5.md)
Roadmap: [../roadmap/current.md](../roadmap/current.md)
Domain index: [../README.md](../README.md)

## Runtime boundary

```text
raw user turn + relevant conversation + typed machine state
→ AI semantic interpretation
→ schema / evidence / reference validation
→ deterministic formal binding / canonical Fact Graph
→ deterministic proposal / question / readiness decisions
→ deterministic work compilation / availability / scheduler
→ typed dialogue decision
→ AI renderer
→ preview
→ explicit approval
→ save
```

Stable V5 is the sole production weekly-planning runtime.

## Ownership

AI owns natural-language meaning: task/component/workload/quantity role, date/weekday/time intent, availability/recurrence/relation, correction/contextual reference, proposal response/authorization intent, and natural realization of a typed application decision.

Deterministic application owns schema/evidence/reference validation, canonical IDs/revision/lifecycle/idempotency, question necessity/target/priority, proposal lifecycle/accepted scope, readiness/work compilation, authoritative occupied sources/availability, scheduler/feasibility, preview freshness, approval/save, persistence/recovery and trace safety.

## Non-negotiable invariants

- SemanticDocument is a current-turn delta, not accepted-state snapshot.
- raw Japanese is not reinterpreted after the semantic boundary by regex/keyword/dictionary/legacy parser to choose semantic truth.
- provider/validation/repair failure does not fall back to a legacy semantic runtime.
- AI does not issue formal IDs, mutate lifecycle, decide readiness, place schedule blocks, approve, or save.
- renderer text is presentation; machine state is not reconstructed from rendered Japanese.
- unresolved or rejected turns do not silently mutate accepted state.
- preview is unsaved and bound to current owner/conversation/revision/source facts.

Detailed semantic ownership lives in [weekly-planning-semantic-ownership-boundary-v5.md](weekly-planning-semantic-ownership-boundary-v5.md). Current task execution belongs to [../work/README.md](../work/README.md), not this architecture document.