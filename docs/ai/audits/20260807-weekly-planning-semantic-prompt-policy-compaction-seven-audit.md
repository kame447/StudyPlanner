# Semantic normalizer policy compaction seven-view audit

Date: 2026-08-07

## Observation

Focused regressions passed except `weeklyPlanningSemanticPromptBudget.test.ts`. The supplemental normalizer policy appended after the core semantic prompt is 2898 bytes against the existing 1800-byte ceiling.

The growth comes from successive bug-specific additions: current-turn delta, quantity-role clarification, work-breakdown clarification, exact cross-turn binding, recurrence, relation semantics, and temporal structure. Most rules are valid, but several restate the same invariants in increasingly specific forms.

## Seven views

1. Meaning ownership: keep AI semantic ownership, exact current-turn delta, and typed pending-question behavior. Do not remove load-bearing semantic boundaries merely to satisfy size.
2. Duplication: core `createWeeklyPlanningSemanticSystemPromptV5` already defines schema meaning, task/component identity, decomposition status, recurrence semantics, relation semantics, and no-invention rules. Supplemental policy should contain only runtime-context rules not already owned by the core prompt.
3. Clarification: collapse separate quantity-role and work-breakdown prose into one generic rule: pendingQuestion is authoritative and clarification output is a minimal current-turn delta bound to the exact target; retain only the exceptional typed work-breakdown constraints that validators require.
4. Cross-turn identity: avoid repeating the full `existingPublicId` definition already present in the core prompt. Supplemental policy only needs to say accepted state is context, not facts to copy.
5. Temporal/recurrence: retain short structural invariants that are not safely implied by schema, but remove explanatory duplication. Recurrence and task relation validators remain fail-closed.
6. Regression safety: do not raise the 1800-byte budget. Tests for current-turn delta, work-breakdown repair, recurrence, exact entity binding, and prompt generalization must still pass after compaction.
7. Scenario independence: compaction must not introduce any observed-example wording. The resulting policy must remain domain- and phrase-independent.

## Generalized compact contract

Supplemental normalizer policy should express only these concepts:

- AI owns meaning; pendingQuestion is authoritative.
- output is a minimal current-userText delta; accepted state/recent conversation are context only; sourceText must come from current user text.
- pending clarification resolves only its exact target; unresolved remains uncertainty.
- work-breakdown clarification returns only the exact target task and its current structure.
- local semantic references use local IDs; accepted entities use exact existingPublicId.
- creation authorization emits intent without replaying state.
- no application decisions/prose.
- recurrence cadence must have recurrence; task relations require explicit scheduling semantics and task IDs; clock/named-period structure remains explicit.

The existing 1800-byte ceiling remains unchanged.
