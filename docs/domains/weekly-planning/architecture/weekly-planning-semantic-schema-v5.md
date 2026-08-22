# weeklyPlanning semantic schema v5

Status: canonical explanatory contract
Updated: 2026-08-22

Parent contract: [current-contract-v5.md](current-contract-v5.md)
Dialogue architecture: [weekly-planning-dialogue-architecture-v5.md](weekly-planning-dialogue-architecture-v5.md)

## Data flow

```text
current user turn
→ SemanticDocument delta
→ closed schema / evidence / reference validation
→ deterministic binding
→ canonical Fact Graph lifecycle
→ planning projection / readiness
→ scheduler input
```

SemanticDocument is not database state, a full conversation snapshot, or a scheduler command.

## Semantic layer may represent

- planning intent/window meaning
- task/component identity and relation
- workload/quantity role/effort
- temporal constraints/recurrence/user availability
- corrections/decisions/contextual references
- durable-context candidates and linguistic scope

Fields that require understanding what the user meant belong to AI semantic interpretation. Formal IDs, revisions, lifecycle operations, arithmetic, readiness and placement do not.

## Current-turn delta contract

Past accepted facts may be supplied as read-only context, but the model does not copy them into the current delta merely because they exist. A fact is emitted when the current contribution newly states, changes, corrects or explicitly decides it.

`sourceText` / provenance must remain grounded according to the active schema contract. Deterministic code must not fabricate replacement evidence for an ungrounded model output.

## Binding and lifecycle

Response-local IDs connect entities only inside one semantic response. Cross-turn continuation uses validated public references/binding context. Application code issues canonical IDs and revisions and owns supersede/removal/no-op/idempotency behavior.

## Failure behavior

Malformed output, schema failure, evidence failure or one-shot repair failure is a controlled semantic failure. It does not authorize legacy parser fallback or silent state mutation.

Exact field truth is owned by the current TypeScript schema/types and tests. The old 2026-07-22 generation registry is retained only as [historical evidence](../../../archive/weekly-planning/legacy/semantic-schema-registry-20260722.md) because its production-status table is no longer current.