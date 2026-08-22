# Stable V5 semantic meaning-rule retention audit

Date: 2026-08-16
Scope: Issue #137 / PR #142

## Question

Which always-on semantic instructions still need to be sent to Luna, and which invariants should instead live in schema, evidence validation, canonicalization, or deterministic application code?

The decision rule used in this audit is:

1. Keep a rule in the semantic prompt only when choosing the value requires understanding the user's language, resolving a contextual referent, or deciding what meaning belongs to the current utterance.
2. Keep schema shape, closed enums, structural consistency, lifecycle validity, canonical IDs, calendar arithmetic after symbolic meaning, scheduling/readiness/proposal decisions, and other mechanical state transitions in deterministic code.
3. Do not add prompt prose merely because one historical model output once failed a scenario. A scenario-specific workaround needs current Real Luna evidence and must not duplicate an invariant already owned elsewhere.
4. Tests should identify semantic contracts by stable rule ID or structural behavior, not by one exact English paraphrase unless the literal wire text itself is the contract.

## Always-on inventory

| Rule ID | Retention basis | Why it remains semantic |
| --- | --- | --- |
| `current_turn_scope` | semantic scope boundary | A validator cannot decide whether a supported fact was actually asserted in the current utterance rather than copied from context. |
| `task_structure` | language interpretation | Task/component identity and attachment targets depend on what the utterance denotes. |
| `study_activity_kind` | language interpretation | The dominant study activity is semantic classification; code validates the resulting closed value. |
| `workload_unit_code` | language interpretation | Mapping the counted unit in language to `word`, `problem`, `page`, etc. requires interpretation; deterministic code must not re-read raw text. |
| `workload_quantity_effort` | language interpretation | Workload, progress, total duration, and per-unit duration are distinct meanings even when they contain similar numbers. |
| `temporal_scope_and_deadline` | language interpretation | Task timing vs plan-wide availability, deadline vs preference, and daypart meaning are semantic distinctions. Concrete calendar arithmetic belongs to deterministic code once symbolic meaning exists; PR #143 tightens that boundary. |
| `availability_absence` | language interpretation | Explicit absence of constraints differs from omission and from positive availability. |
| `contextual_reference_binding` | contextual reference resolution | Omitted/pronominal targets require conversation and typed-state grounding; deterministic label guessing is disallowed. |
| `explicit_recurrence_sources` | language interpretation | Whether recurrence or an external source was explicitly requested is utterance meaning, not a default. |
| `durable_learning_preference` | language interpretation | A durable preference must be distinguished from a choice limited to the current plan before persistence logic runs. |
| `independent_clause_decision_correction` | language interpretation | Clause independence, corrections, and proposal decisions are discourse semantics; lifecycle code applies them afterward. |

## Existing tests reviewed

- `weeklyPlanningSemanticAbstractionGuards.test.ts`: keep. It protects the deterministic side from re-interpreting AI semantics through raw-text phrase routing.
- `weeklyPlanningSemanticPromptBudget.test.ts`: keep. It constrains prompt size and rejects regression-specific/scenario-specific prompt hardcoding; it does not define one English paraphrase as semantic truth.
- `weeklyPlanningSemanticUnitCodePolicyV5.test.ts`: already uses the stable `workload_unit_code` rule ID rather than pinning one whole sentence.
- `weeklyPlanningSemanticUserContextV5.test.ts`: deadline behavior is asserted through the `temporal_scope_and_deadline` contract ID and negative anti-hardcoding checks rather than one positive English sentence.
- `weeklyPlanningDurableConcernBasisV5.test.ts`: keep as a negative contract. The closed concern basis is already represented in schema, so the test prevents obsolete regression prose from returning to the prompt.
- `weeklyPlanningSemanticRepairPromptV5.test.ts`: focused repair directives remain literal where the repair payload itself is the behavior under test; these are not the always-on meaning policy.

## Result

The current eleven always-on rules all have a semantic retention reason after classification. This audit therefore does **not** remove a rule merely to reduce prompt length. The new rule metadata is review-only and is not included in the provider prompt, so PR #142 does not change Luna behavior by adding this inventory.

The main redundancy found was not an additional always-on rule but responsibility ambiguity around relative-date canonicalization. That is handled separately by PR #143: semantic interpretation keeps supported relative meaning symbolic and deterministic calendar resolution owns concrete date arithmetic.

## Remaining evidence gate

Deleting or materially weakening one of the eleven semantic instructions requires a Real Luna ablation against realistic conversations, including gradual multi-turn convergence and correction/reference cases. This GitHub connection can inspect Actions runs but cannot dispatch the manual Real Luna workflow, so this audit deliberately does not claim an ablation was executed. The rule inventory now identifies the exact unit to remove or rewrite when such evidence is run, without coupling tests to the current English wording.
