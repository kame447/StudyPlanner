# Durable concern semantics / history seven-view audit

Date: 2026-08-07

## Observed failure

During a work-breakdown answer, the user said one constituent had more work than another. The semantic AI emitted a durable `concern` signal on that subject with a value equivalent to “remaining / larger amount”. The owner context store then replaced the previously valid concern for the same subject (`結構まずい`) with this new value and Turn 3 provenance.

Two independent defects are involved:

1. semantic concern boundary is too permissive for purely descriptive workload magnitude;
2. owner context identity for concerns is only `kind + label`, so a different concern value destructively overwrites prior history.

## Seven views

1. Meaning: durable concern is subjective or evaluative state useful in later planning: difficulty, weakness, worry, lack of confidence, being behind, or comparable continuing concern. Quantity, size, frequency, duration, or “more work than X” alone is not a concern.
2. AI ownership: the semantic model decides whether wording is concern. Deterministic code must not inspect Japanese tokens such as `多い`, `苦手`, or `不安`.
3. Prompt generalization: production instructions should state the positive concern definition and generic negative boundary (pure descriptive amount/size/frequency/duration comparison is not concern). Do not add triggering scenario vocabulary.
4. Persistence: owner context is history. Different concern statements for the same label must not destroy earlier source/provenance. Concern record identity therefore cannot be only `kind + label`.
5. Reaffirmation: an exactly repeated `kind + label + value` concern should not create a new historical copy or change its original provenance merely because a later turn repeats it. Existing copied-context normalization already suppresses exact copies.
6. Change/coexistence: two genuinely different concern values may both be useful (for example separate difficulties about one subject). Preserve distinct concern records by value rather than silently treating any different value as replacement. A future explicit resolution/supersession model can retire concerns; this patch must not invent such resolution from ordinary text.
7. Testing/observability: verify descriptive workload comparison produces no concern in real API; original concern remains with original Turn 2 provenance; storage unit tests preserve two distinct concern values and deduplicate exact same value; prompt has no scenario-specific terms.

## Generalized fix

### Semantic contract

Clarify durable concern instructions:

- emit concern only for an explicitly subjective/evaluative continuing difficulty, weakness, worry, confidence problem, being behind, or comparable concern relevant to later plans;
- do not emit concern from descriptive workload amount, relative size, frequency, duration, or quantity comparison alone;
- do not translate workload magnitude into scheduling priority.

This remains AI-owned interpretation; validators continue to verify structure/evidence, not Japanese sentiment.

### Storage identity

For `concern`, include normalized `value` in persistent identity / record ID in addition to kind and label. For `goal_event`, retain the existing date-based identity.

Consequences:

- exact same concern value remains one record;
- a different concern value does not erase earlier history;
- provenance of earlier record remains intact;
- active prompt context may contain multiple distinct current concerns for one entity until an explicit resolution lifecycle is designed.

Do not mark an old concern historical merely because a different concern value appeared; that would incorrectly assume replacement semantics.
