# Weekly Planning Stable V5 semantic ownership boundary

Status: canonical semantic ownership contract
Updated: 2026-08-27
Integration base: the semantic rule contract inventory merged from PR #142, with scheduler-facing temporal ownership refined by PR #204.

This document narrows the ownership boundary already stated in `weekly-planning-dialogue-architecture-v5.md`. The goal is to prevent application-internal decisions from drifting into the LLM layer while also avoiding deterministic re-interpretation of raw user text.

## Rule

The semantic model owns **meaning that requires natural-language interpretation**. Deterministic application code owns **mechanical representation, validation, state transition, and planning decisions after that meaning is represented**.

The application must not re-read raw user text with regex/keywords to choose a different meaning after the semantic model has returned a document.

## AI-owned meaning

- Whether the current turn expresses a task, component, workload, effort, temporal constraint, recurrence, correction, decision, availability declaration, or durable user context.
- The attachment target of those facts when the linguistic referent is clear.
- Whether a counted unit semantically corresponds to `word`, `problem`, `page`, etc. `unitCode` is therefore semantic classification; deterministic code validates the closed code set but does not infer a different unit from raw Japanese text.
- Whether a temporal phrase means today, tomorrow, this/next week, a weekday, an explicit absolute date, or a custom/unsupported expression.
- Ambiguity. When meaning is not uniquely supported, the semantic layer emits uncertainty instead of asking deterministic code to guess.

## Deterministic-owned representation and decisions

- Calendar arithmetic after a supported symbolic date meaning exists. For example, `next_week` plus the captured request date/week boundary becomes a concrete date range in `weeklyPlanningCalendarResolver`.
- Canonical planning-window wire values after validated start/end dates exist.
- Canonical weekday/time encodings that are mechanically derivable from already interpreted semantic values.
- Scheduler-facing compilation of already accepted temporal facts into absolute hard date bounds and preferred placements.
- Schema and evidence validation.
- Public/internal fact IDs, graph revision, lifecycle, correction transactions, dependency safety, and stale-revision rejection.
- Missing-information/readiness decisions, question target, proposal state, authorization, scheduler input, feasibility, preview, approval, and save.

## Relative-date boundary

The model should keep supported relative meanings symbolic rather than performing calendar arithmetic merely because `calendarContext` is available.

Example:

```text
User: 来週の予定を作りたい
Semantic meaning: relative_week / next_week
Deterministic resolver: captured request date + weekStartsOn -> concrete start/end
```

Composite expressions that the current schema cannot represent symbolically must remain an explicit schema limitation. Do not silently add raw-text deterministic parsing to compensate; either extend the semantic representation or keep the meaning unresolved.

## Scheduler-facing temporal compilation boundary

After temporal meaning has been accepted into typed state, placement code must not become a second semantic owner of the same constraint.

For movable-work date constraints and preferences, the deterministic boundary resolves supported symbolic date expressions and compiles the applicable accepted facts into scheduler-facing values such as:

```text
hardDateBounds
preferredPlacements
```

The compilation boundary owns the mechanical questions needed for those scheduler inputs: which active accepted constraint applies to the target, whether a task-level constraint is inherited by component work, which absolute date results from the already interpreted date expression, and which source fact IDs justify the compiled value.

Downstream work distribution and placement consume the compiled values. They must not independently walk the raw temporal Fact Graph to reinterpret deadline / earliest-start / latest-end / preferred-window semantics or let a component-specific constraint leak to a sibling component.

This does not mean every temporal operation is represented by `hardDateBounds`. Fixed commitments and other explicitly separate scheduler contracts may retain their own typed compilation path. The rule is that one semantic/application decision has one owner; a downstream path must not independently re-decide a meaning already compiled upstream.

## Test rule

Tests should protect the semantic contract or deterministic invariant, not one incidental English sentence used to explain that contract to the provider. Literal prompt assertions are appropriate only when the literal repair payload itself is the external contract.

## Change rule

Before adding a new prompt instruction or deterministic normalizer, identify which side owns the decision:

1. If choosing the value requires understanding the user's language or referent, it belongs to semantic interpretation.
2. If the meaning is already represented and the remaining transformation is mechanical, it belongs to deterministic code.
3. If both layers currently make the same semantic choice, remove one owner rather than adding reconciliation heuristics.
