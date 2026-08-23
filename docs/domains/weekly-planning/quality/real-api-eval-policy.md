# Weekly Planning real-API evaluation policy

Status: supporting quality policy
Updated: 2026-08-23

Parent test policy: [test-philosophy.md](test-philosophy.md)

This document defines the default evaluation cadence for Stable V5 weekly-planning semantic/dialogue changes.

## Principle

Real `gpt-5.6-luna` evaluation is a required correctness tool, not a substitute for deterministic tests. Use the cheapest deterministic layer that can reject a defect, then use real-model runs where nondeterminism, semantic interpretation, natural-language realization, or model/application contract adherence must be observed.

Do not treat one successful model response as proof of correctness. Real-model results must be repeated and, for merge gates, transcripts and Fact Graph state must be manually reviewed.

## Tier 1 — every push

Run deterministic checks only:

- TypeScript / static checks
- unit tests
- integration tests
- Fact Graph lifecycle/canonicalization tests
- scheduler/application state tests
- renderer contract/validator tests with deterministic fixtures
- production build
- browser regression where applicable

A normal push must not automatically trigger the full real-API matrix.

## Tier 2 — semantic/dialogue checkpoint

Run a focused real-Luna checkpoint when a coherent change to any of the following is ready for evaluation:

- semantic prompt/schema/policy
- dialogue prompt/contract/validator
- question intent projection
- grounding/acknowledgement behavior
- contextual answer binding
- Fact Graph meaning normalization whose correctness depends on model output

Default repetition: 3–5 generations per affected stochastic surface.

Run only scenarios affected by the checkpoint plus a small invariant smoke set. If the real-model run exposes a defect, reproduce it deterministically where possible before the next checkpoint run.

## Assistant-triggered execution

The repository supports repeated real-Luna execution from an AI-assisted GitHub workflow without requiring a person to open the Actions UI.

The canonical trigger is `.github/weekly-planning-real-api-command.json`. Updating that file on an `agent/**` branch starts `Weekly Planning Real API Checkpoint`. Change `profile` to either `checkpoint` or `merge-gate`, and change `request_id` for each requested run so the trigger commit is explicit and auditable. `reason` records why the run was requested.

This command-file trigger is the preferred route when ChatGPT is actively auditing a PR. `workflow_dispatch` remains available for manual use. A normal source push still does not run the full real-API matrix unless the command file itself is updated.

After each run, inspect the workflow conclusion and uploaded observation artifact. A green workflow is not sufficient by itself for a merge gate; visible transcripts and resulting machine state still require review.

## Tier 3 — merge gate

Before merging a PR that materially changes weekly-planning AI behavior, run the full real-API audit on the final product head.

Default repetition: at least 10 generations/variants for high-risk renderer/semantic contracts, unless the matrix itself already provides equivalent repeated coverage.

The merge gate must include, as applicable:

- full application-path conversations
- semantic + renderer paths, not renderer-only mocks
- all runtime question codes / typed intents
- side-contribution acknowledgement before resuming a pending question
- clarification completeness
- correction/revision lifecycle
- percentage/open-ended progress
- fixed-total progress
- percentage → exact-quantity transitions
- completed-work behavior and reopening after correction
- relation repair and quantity-role stress
- preview/execution boundary safety
- validator fail-closed behavior

Review both:

1. the visible transcript, and
2. the resulting Fact Graph / application machine state.

A formally green test with an unnatural transcript or inconsistent Fact Graph is a failed merge gate.

## Cost discipline

Do not reduce real-API coverage merely to save a small amount of API cost when the run has meaningful defect-detection value.

Do avoid duplicate low-value calls:

- do not run a 50–100+ call full matrix after every one-line push;
- do not use Luna to test invariants already fully determined by application code;
- after a real-model failure, add deterministic regression coverage when possible so the same defect is rejected before the next expensive run;
- keep the heavy matrix for checkpoints and the final merge gate.

The objective is high defect detection per API call, not minimum API usage.

## Acceptance rule

A weekly-planning AI change is not considered fully validated solely because deterministic CI is green. If the change affects semantic interpretation or dialogue realization, the appropriate Tier 2 or Tier 3 real-Luna evidence is required.

Conversely, a real-Luna green run does not override deterministic failures. Both layers must pass.
