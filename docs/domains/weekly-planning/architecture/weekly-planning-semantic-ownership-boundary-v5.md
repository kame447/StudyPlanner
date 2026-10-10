# Weekly Planning Stable V5 semantic ownership boundary

Status: canonical semantic ownership contract
Updated: 2026-10-10
Integration base: the semantic rule contract inventory merged from PR #142, with scheduler-facing temporal ownership refined by PR #204.

This document narrows the ownership boundary already stated in `weekly-planning-dialogue-architecture-v5.md`. The goal is to prevent application-internal decisions from drifting into the LLM layer while also avoiding deterministic re-interpretation of raw user text.

Planned Issue #246 learning consultation requirements live in [../spec/learning-consultation-and-advice.md](../spec/learning-consultation-and-advice.md). That document extends the same ownership rule to user-initiated consultation/advice while runtime implementation remains pending.

## Rule

The semantic model owns meaning that requires natural-language interpretation. Deterministic application code owns mechanical representation, validation, state transition, and planning decisions after that meaning is represented.

The application must not re-read raw user text with regex/keywords to choose a different meaning after the semantic model has returned a document.

## AI-owned meaning

- Whether the current turn expresses a task, component, workload, effort, temporal constraint, recurrence, correction, decision, availability declaration, or durable user context.
- The attachment target of those facts when the linguistic referent is clear.
- Whether a counted unit semantically corresponds to `word`, `problem`, `page`, etc. `unitCode` is therefore semantic classification; deterministic code validates the closed code set but does not infer a different unit from raw Japanese text.
- Whether a temporal phrase means today, tomorrow, this/next week, a weekday, an explicit absolute date, or a custom/unsupported expression.
- Ambiguity. When meaning is not uniquely supported, the semantic layer emits uncertainty instead of asking deterministic code to guess.

For the planned Issue #246 extension, the semantic layer also owns natural-language meaning such as:

- whether the user is asking for learning consultation/advice rather than merely supplying a planning fact or operation;
- what the consultation concerns: learning strategy, material choice, order, target milestone, feasibility explanation, comparison, rationale, etc.;
- references to previously presented advice/options such as `それで`, `1つ目`, `期限だけ変えて`;
- whether the user accepts, modifies, rejects, or separately expresses durable scope such as `今後も`.

This does not require one flat `intent` enum to carry every mixed-turn contribution. Exact schema shape belongs to the current TypeScript semantic contract when implemented.

## Deterministic-owned representation and decisions

- Calendar arithmetic after a supported symbolic date meaning exists. For example, `next_week` plus the captured request date/week boundary becomes a concrete date range in `weeklyPlanningCalendarResolver`.
- Canonical planning-window wire values after validated start/end dates exist.
- Canonical weekday/time encodings that are mechanically derivable from already interpreted semantic values.
- Scheduler-facing compilation of already accepted temporal facts into absolute hard date bounds and preferred placements.
- Schema and evidence validation.
- Public/internal fact IDs, graph revision, lifecycle, correction transactions, dependency safety, and stale-revision rejection.
- Missing-information/readiness decisions, question target, proposal state, authorization, scheduler input, feasibility, preview, approval, and save.

For planned Issue #246, deterministic application also owns:

- whether a validated consultation contribution can be executed safely;
- bounded context assembly from Bookshelf, user context, Plan/Actual/reporting and other source owners;
- AdviceProposal / option / item identity and revision;
- presented / accepted / modified / rejected / superseded / stale lifecycle;
- reference binding to the correct advice identity after semantic meaning is represented;
- staleness and idempotency checks;
- promotion of accepted advice scope into normal Stable V5 planning contributions;
- deterministic numeric calculations and capacity/feasibility signals supplied to the answer model;
- persistence, recovery, preview, approval and save boundaries.

The answer model may generate learning strategy prose and structured recommendation candidates, but it does not own formal acceptance, promotion or schedule mutation.

## Ordinary conversation acts

The semantic delta may carry four additive ordinary acts: answering the pending question, asking what/why it means, shifting topic, and resuming a topic. These are interpretation evidence, not permission to mutate planning, accept a proposal, generate a preview or save. Independent planning facts in a mixed turn still pass the complete existing validation and canonical transaction. An answer act without a valid planning contribution does not answer a machine question. An act-only exception does not exempt a B-only planning contribution from the existing pending-A work-breakdown contract.

The provider supplies only the act kind and an existing task/component public reference or null. For a resume act whose emitted reference is unavailable, reference resolution records rejected-target evidence; provider-authored resolution metadata is rejected. Targetless/null resume and a rejected named target remain distinct. Interpreting an unknown natural-language name remains AI-owned: deterministic code does not infer it from Japanese text. The semantic layer may express unresolved meaning as uncertainty. If the model instead incorrectly emits a valid-looking null target, these reference guards alone cannot detect that interpretation error; correct referent interpretation remains an actual-model acceptance requirement.

The application may select an existing active, non-deferred question from these validated acts. The actual router retains proposal and preview priority. Explanation and named resume require the actual routed question's existing finite identity to agree: code, canonical target, effort intent, estimate target, question basis and action identity. Turn-local selection is not a new persisted authority. The existing question-presentation owner still decides whether a displayed question is fresh enough for a later short answer.

An aside keeps the current graph-derived pending question and values, without inserting aside prose into its machine question or binding the aside as a question. The router may regenerate current question wording; old AI text is not restored over an accepted correction. If aside rendering fails after a valid planning contribution commits, the bounded technical failure message must not claim that contribution was unapplied. Semantic rejection retains the existing R0 recovery and rollback contract.

The renderer consumes this typed communication goal rather than independently classifying explanation intent from raw text. Normal replies remain AI-rendered. No conversation mode, new act authority in PlanningState, the Fact Graph or Plan, advice lifecycle, budget-completion feature or alternate semantic runtime is introduced by these four acts. Diagnostic/outbox traces retain the actual request and bounded act/goal evidence under the existing size and explicit-truncation contract; they are not a second planning state.

## Consultation routing boundary — planned Issue #246

Do not solve consultation by adding a deterministic raw-text router such as:

```text
if text contains "おすすめ" or "どの参考書"
  → consultation
```

Correct shape:

```text
raw user turn + conversation
→ AI semantic interpretation
→ validated typed consultation meaning
→ deterministic application routing
```

The application may branch deterministically on validated typed semantic output and machine state. It may not independently decide the user's linguistic intent by inspecting Japanese keywords after the semantic boundary.

Current assistant-side clarification `question` and user-initiated consultation are different responsibilities. Do not overload one machine state merely because both involve a question in ordinary language.

Mixed turns such as `このままで間に合う？無理なら少し増やして` may contain consultation plus conditional mutation. Before implementing partial acceptance, verify what the current atomic semantic commit contract can safely represent. Do not split such turns with ad-hoc raw-text parsing.

## Relative-date boundary

The model should keep supported relative meanings symbolic rather than performing calendar arithmetic merely because `calendarContext` is available.

Example:

```text
User: 来週の予定を作りたい
Semantic meaning: relative_week / next_week
Deterministic resolver: captured request date + weekStartsOn -> concrete start/end
```

Composite expressions that the current schema cannot represent symbolically must remain an explicit schema limitation. Do not silently add raw-text deterministic parsing to compensate; either extend the semantic representation or keep the meaning unresolved.

The same distinction applies to consultation. The answer model may propose `10月末まで` as advice, but that prose does not become an accepted deadline. If the user adopts it, semantic interpretation represents the adoption/reference meaning and deterministic application binds/promotes it through the normal temporal contract.

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

Consultation-specific code must not become another temporal compiler. Accepted advice returns to the normal planning representation before scheduler-facing compilation.

## Test rule

Tests should protect the semantic contract or deterministic invariant, not one incidental English sentence used to explain that contract to the provider. Literal prompt assertions are appropriate only when the literal repair payload itself is the external contract.

For Issue #246, real-model evaluation should test consultation/adoption/reference meaning across varied Japanese phrasing, while deterministic tests protect lifecycle, identity, stale rejection, promotion and no-silent-mutation invariants. Do not convert representative Japanese examples into production keyword rules.

## Change rule

Before adding a new prompt instruction or deterministic normalizer, identify which side owns the decision:

1. If choosing the value requires understanding the user's language or referent, it belongs to semantic interpretation.
2. If the meaning is already represented and the remaining transformation is mechanical, it belongs to deterministic code.
3. If both layers currently make the same semantic choice, remove one owner rather than adding reconciliation heuristics.
4. If the new behavior is advisory reasoning rather than user-language interpretation, keep the answer/recommendation purpose separate from formal application lifecycle authority.
