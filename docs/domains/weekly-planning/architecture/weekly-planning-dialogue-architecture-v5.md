# weeklyPlanning dialogue architecture v5

Status: canonical supplement / Stable V5
Updated: 2026-10-07

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

## Interaction layer (Issue #488)

Between the semantic result and the typed dialogue decision sits a deterministic interaction decision. It consumes typed `conversationActs` plus machine state and presentation freshness and chooses apply / explain / aside / resume / recover, and hands the renderer a typed communication context (the goal of the reply, machine-owned purpose codes for the question, status reason, disclosure and flags). Deterministic code decides WHAT is communicated; the renderer decides HOW and writes every reply of the interaction architecture, recoveries included. Fixed wording exists only as the short emergency text used when the renderer cannot run or its output fails validation. The three responsibilities (semantic interpretation, interaction control, deterministic planner/persistence) are boundaries inside the existing turn, not separate AI systems. Details and invariants: [current-contract-v5.md](current-contract-v5.md#conversation-interaction-three-responsibilities-issue-488).

## Non-negotiable invariants

- SemanticDocument is a current-turn delta, not accepted-state snapshot.
- raw Japanese is not reinterpreted after the semantic boundary by regex/keyword/dictionary/legacy parser to choose semantic truth.
- provider/validation/repair failure does not fall back to a legacy semantic runtime.
- AI does not issue formal IDs, mutate lifecycle, decide readiness, place schedule blocks, approve, or save.
- renderer text is presentation; machine state is not reconstructed from rendered Japanese, and the renderer does not decide the conversational turn kind from the user message.
- ordinary replies never describe the app's internals (data processing, validation, states, providers, retries); deterministic prose does not stand in for a conversational reply.
- unresolved or rejected turns do not silently mutate accepted state.
- preview is unsaved and bound to current owner/conversation/revision/source facts.

Detailed semantic ownership lives in [weekly-planning-semantic-ownership-boundary-v5.md](weekly-planning-semantic-ownership-boundary-v5.md). Current task execution belongs to [../work/README.md](../work/README.md), not this architecture document.