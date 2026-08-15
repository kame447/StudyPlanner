# Adaptive Memory Learning — implementation checkpoint (2026-08-15)

## Status

This document records the current implementation checkpoint for PR #130. It supplements, but does not replace, the strategy SSoT:

- `docs/ai/strategy/weekly-planning-adaptive-memory-learning-policy.md`
- `docs/ai/tasks/20260815-weekly-planning-human-grounding-dialogue-policy.md`
- `docs/ai/tasks/20260814-weekly-planning-conversation-quality-luna-audit.md`
- `docs/ai/strategy/weekly-planning-roadmap.md`

The governing architecture remains:

> Interpret ambiguous human meaning with AI. Once meaning is unique, application code owns policy, state, calculation, scheduling, approval, persistence, and lifecycle.

## Product policy now treated as authoritative

### 1. Generalize beyond vocabulary

The feature is for memorization / retrieval-heavy learning, not for the literal word unit or English vocabulary only. Examples include vocabulary, terminology, historical facts, formulas, and qualification-study facts.

The semantic layer classifies the dominant study activity. Application policy never infers memorization from raw Japanese keywords or from `word` as a unit.

### 2. Distributed retrieval is a proposal, not an automatic rule

For a memorization-heavy workload, the app may propose a distributed-retrieval strategy because repeated retrieval separated in time generally supports retention better than massed repetition.

Cold-start session duration of 15–30 minutes is an application proposal, not a scientific universal optimum and not an automatic scheduler rule.

The app must not automatically:

- split a vocabulary count by a word-count threshold;
- place sessions in morning / afternoon / night;
- add two or three review rounds;
- assume three passes are required;
- assume a fixed 1/3/7-day forgetting-curve schedule;
- treat one-session duration as the total time required for the whole memorization scope.

### 3. Common-ground rule

An internal heuristic is not shared knowledge.

The app must first surface the proposal and, where appropriate, the reason. Only the scope the user accepts becomes shared policy. A later utterance may rely on that accepted policy, but not on an unspoken heuristic.

The renderer must receive typed proposal meaning. It must not reconstruct the policy from a generic question code.

### 4. Session duration and spacing interval are distinct

For the initial distributed-practice proposal:

- `15–30 minutes` means suggested duration of one learning session;
- spacing interval is not yet selected;
- the renderer must not rephrase 15–30 minutes as the interval between reviews.

### 5. Large volume / short deadline

If evidence later shows that short sessions alone are unlikely to cover the requested scope by the deadline, the app may propose a mixed strategy:

- longer blocks for initial exposure / acquisition;
- shorter distributed retrieval for retention.

The app still does not apply that policy without acceptance.

If even the mixed strategy is infeasible, the app should propose an explicit choice such as broad first exposure versus narrowing the scope for stronger retention.

### 6. Personal memory layers

Keep three concepts separate:

1. week / conversation state;
2. durable user preference;
3. observed learning profile.

A week-scoped acceptance such as “20 minutes this week” must not silently become a global preference.

A durable statement such as “I want memorization sessions to be about 20 minutes from now on” may be stored as a long-term learning preference.

Observed performance must remain separate from preference. The preferred duration is not overwritten merely because measured performance differs.

## Implemented in PR #130

### Semantic classification

Stable V5 now has a typed study-activity classification including `memorization_retrieval`. New Luna structured output is required to return the classification for study details. Existing fixtures/checkpoints may omit it and are treated as unknown for migration compatibility.

### Weekly proposal lifecycle

A dedicated weekly learning-strategy proposal ledger exists independently of legacy slot-assumption proposals.

The current proposal kinds are:

- distributed memory practice;
- personal pace calibration.

Proposal IDs are deterministic. Accept/reject decisions must refer to the exact public proposal ID exposed in application state.

### Distributed-practice proposal

When the current semantic activity is memorization/retrieval-heavy and the exact workload lacks enough effort information, the app may create a pending distributed-practice proposal.

The proposal is surfaced before the generic missing-effort question.

The proposal is not created from a `word` unit, task title, Japanese regex, or keyword parser.

### One-session duration after acceptance

Only after the distributed-practice proposal is accepted does the app ask for the desired duration of one session.

The answer is bound deterministically to the measurement the app asked about. For example, “20 minutes” after that question becomes a one-session duration, not a total-duration estimate for the entire memorization scope.

The old `word => session duration` heuristic has been removed.

### Pace calibration proposal

Once an accepted distributed-practice strategy has one exact session duration, the app creates a second proposal to run one calibration session and measure personal pace.

Example meaning:

> First try one 20-minute session and record how far you get. Use that observation to adjust the remaining amount and later reviews.

This is also opt-in.

### Calibration scheduler projection

After the pace-calibration proposal is accepted, the scheduler receives an ephemeral projection representing exactly one session of the selected duration.

Important invariant:

- the persisted Fact Graph still contains the original full memorization scope;
- the persisted effort remains one-session duration;
- the original scope is never rewritten as “the whole scope takes 20 minutes”;
- the ephemeral scheduler projection preserves the original workload public ID so already-grounded date/time constraints continue to apply;
- normal scheduler availability / hard-constraint logic is reused instead of being duplicated in memory-specific code.

### Long-term explicit preference

The existing user-level planning-context store now supports a durable `learning_preference` kind.

The semantic policy permits this kind only for an explicitly cross-plan / durable preference. A choice scoped to the current week or plan is not durable context.

The runtime snapshot validator was updated so the new preference kind survives persistence and remains active across later weeks when it has no expiry date.

Observed learning performance is intentionally not stored as a preference.

## Removed historical vocabulary heuristics

Production no longer treats the following as accepted behavior:

- vocabulary 100-word batching;
- automatic morning / afternoon / night placement;
- automatic two-review expansion;
- fixed review daypart defaults;
- asking users to estimate the total time required to memorize a vocabulary scope as the default vocabulary flow;
- treating `word` as proof that a one-session strategy has been accepted.

Historical tests that asserted those behaviors have been replaced with proposal/acceptance and semantic-boundary tests.

## Real Luna evidence

### Turn 1 attempt 1 — run 31879455622

Semantic interpretation succeeded in one call with no repair and classified the task as memorization/retrieval-heavy. Application proposal state was correct, but the final Luna renderer did not receive typed proposal meaning and changed the question into a generic distribution question. This run is failure evidence for renderer grounding, not acceptance evidence.

### Turn 1 attempt 2 — run 31879695945

Typed proposal meaning reached the renderer. The result preserved distributed retrieval and the 15–30-minute value, but wording could be read as though 15–30 minutes described the spacing interval. This exposed an ambiguity in the structure passed to the renderer.

### Turn 1 attempt 3 — run 31879896414

PASS.

Luna produced the equivalent of:

> 英単語220語は、15〜30分くらいの短い学習時間に分けて、間隔を空けながら何度か思い出す形にすると定着しやすいです。この進め方で予定を組んでみますか？

Acceptance points:

- 15–30 minutes clearly refers to one learning session;
- distributed retrieval rationale is preserved;
- no concrete spacing interval is invented;
- the strategy remains a proposal requiring user acceptance;
- no total-duration question is asked.

Run `31879896414` is the current real-Luna checkpoint for continuation testing.

## Tests added / updated

Coverage now includes:

- memorization activity creates a proposal, problem solving does not;
- exact proposal accept / reject lifecycle;
- no proposal duplication;
- no one-session policy inferred from word unit or word-count threshold;
- one-session duration is bound from typed pending-question meaning;
- proposal renderer receives exact typed proposal meaning;
- session duration and spacing interval are distinct renderer fields;
- explicit durable learning preference remains active across later weeks;
- calibration proposal appears only after session duration is known;
- accepted calibration compiles a single trial session without rewriting the full scope;
- the original workload remains intact and no fake total duration is persisted;
- a four-turn integration test covers proposal -> acceptance -> session duration -> calibration proposal -> calibration preview.

## Remaining work before this loop is complete

1. Re-establish full CI + Browser Regression green on the newest calibration-scheduler head.
2. Continue real Luna from run `31879896414`:
   - “それでお願いします。”
   - “20分くらいがいいです。”
   - “まずそれで試したいです。”
3. Inspect each artifact, not only workflow status.
4. Verify the final accepted calibration preview contains one session only, preserves hard constraints, and never claims the full 220-word scope is complete.
5. Add observed-learning-profile persistence only as a separate typed concept from preference. Do not encode observations as opaque preference strings.
6. Add the evidence above to the main Luna audit and roadmap acceptance status after real-API continuation passes.
7. Re-scan active documentation for stale vocabulary threshold / automatic review / automatic daypart wording.
