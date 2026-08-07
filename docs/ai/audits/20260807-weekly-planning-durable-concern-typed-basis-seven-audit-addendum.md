# Durable concern typed-basis seven-view audit addendum

Date: 2026-08-07

## Why the prompt-only boundary is insufficient

The durable-concern prompt was already generalized to say that descriptive amount/size/frequency/duration comparisons are not concerns. In a real API rerun, the provider still emitted `量は多い` as a concern signal. This proves that free-form `kind=concern + value` leaves the semantic boundary too weak.

## Seven views

1. Meaning: long-term concern must represent an explicit subjective/evaluative difficulty useful in later planning, not a factual workload description.
2. AI ownership: AI still makes the semantic decision; deterministic code must not classify Japanese words.
3. Structured contract: every concern signal must state a typed basis. Allowed bases are `difficulty`, `weakness`, `worry`, `low_confidence`, `behind`, and `motivation_problem`. No generic catch-all is provided, because it would recreate the current ambiguity.
4. Evidence: `sourceText` remains current-user evidence. The basis does not replace evidence; it states which durable-concern concept the provider claims is present.
5. Compatibility: new provider JSON Schema requires basis. Runtime TypeScript/validator may accept omitted basis only for old fixtures/checkpoints during migration. New real API responses must always provide it.
6. Persistence: basis is transport/semantic metadata. Existing owner context keeps `kind/label/value/source` history; distinct values stay distinct. The storage layer must not infer concern basis or overwrite older provenance.
7. Generalization/testing: production prompts contain no observed sentence. Test a subjective concern and a structurally similar descriptive amount comparison. The latter must yield no concern in real API. Also verify schema requires basis and prompt budget remains within the existing ceiling.

## Generalized fix

- Add required provider field `basis` to entity-local concern signals.
- Define a closed semantic enum for the explicit subjective concern categories above.
- Update prompt to say no allowed basis => emit no concern signal.
- Validator checks only enum/schema structure; it does not infer meaning from text.
- Preserve old fixture compatibility by stripping/accepting omitted basis only at the internal legacy validation boundary, not in provider JSON Schema.
