# weeklyPlanning semantic schema v5

Status: canonical explanatory contract
Updated: 2026-08-22

Parent contract: [weekly-planning-current-contract-v5.md](../ai/weekly-planning-current-contract-v5.md)
Dialogue architecture: [weekly-planning-dialogue-architecture-v5.md](weekly-planning-dialogue-architecture-v5.md)
Schema registry: [weekly-planning-semantic-schema-registry.md](weekly-planning-semantic-schema-registry.md)

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

SemanticDocument is not database state, not a full conversation snapshot, and not a scheduler command.

## Semantic layer may represent

- planning intent
- planning window meaning
- task / component identity and relation
- workload / quantity role / effort
- temporal constraints / recurrence / user availability
- corrections / decisions / contextual references
- durable-context candidates and their linguistic scope

Fields that require understanding what the user meant belong to AI semantic interpretation. Formal IDs, revisions, lifecycle operations, arithmetic, readiness and schedule placement do not.

## Current-turn delta contract

Past accepted facts may be supplied as read-only context, but the model does not copy them into the current delta merely because they exist. A fact is emitted when the current user turn newly states, changes, corrects or explicitly decides it.

`sourceText` / provenance must remain grounded in the current contribution according to the active schema contract. Deterministic code must not fabricate replacement evidence for an ungrounded model output.

## Binding and lifecycle

Local response IDs exist only to connect entities inside one semantic response. Cross-turn continuation uses validated public references / binding context. Application code issues canonical IDs and revisions and owns supersede / removal / no-op / idempotency behavior.

## Failure behavior

Malformed output, schema failure, evidence failure or one-shot repair failure is a controlled semantic failure. It does not authorize legacy parser fallback or silent state mutation.

Exact field definitions are owned by the current TypeScript schema/types and [weekly-planning-semantic-schema-registry.md](weekly-planning-semantic-schema-registry.md); do not duplicate the full registry here.
