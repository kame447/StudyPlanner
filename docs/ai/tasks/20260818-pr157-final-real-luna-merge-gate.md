# PR #157 final Real Luna merge gate

Status: active / merge blocked
Updated: 2026-08-19
Branch: `agent/issue156-prompt-simplification-adversarial-audit`
Issue: #156
PR: #157

## Purpose

Finish the adversarial follow-up to PR #130 without adding sentence-specific patches. The final gate verifies that typed application decisions, human grounding, progress/correction handling, and dialogue realization agree under deterministic CI, browser regression, and repeated real `gpt-5.6-luna` runs.

## Deterministic regression checkpoint

The implementation checkpoint `6fa31b95358fbf8019e22f349cf35ca71638565b` exposed seven deterministic failures around pending-question contextual answers. Browser Regression was green, prompt-budget tests were green, but full CI had 1729 passing tests and 7 failures.

The common cause was a side-contribution guard that treated every semantic task without `existingPublicId` as independent new work. A short answer can legitimately arrive from the semantic normalizer inside a temporary task shell with no `existingPublicId`, so that rule bypassed the guarded contextual binder.

The routing fix identifies independent meaning from typed semantic content rather than task identity alone. It preserves genuine deadlines, recurrence/context changes, remaining/completed workload changes, target-only new work, and new components through normal canonicalization while allowing a temporary effort-answer shell to bind to the exact pending target.

After that repair, the previously failing seven cases returned to green together on checkpoint `c5bca176b5d844a269a65de9c4ce6ffd7780c905`, including ordinary short-duration turns, observed-pace flows, memory calibration, atomic incompatible-reply handling, and the Stable V5 multi-turn task → duration → authorization path.

## Required dual-target contract

Progress-derived pace questions can contain two different workload references:

- `questionTargetWorkload`: the workload fact used as evidence for the question, such as already-completed work;
- `estimateForWorkload`: the workload that is actually schedulable and whose effort estimate is needed, such as derived remaining work.

This distinction is active only when the typed pending question carries `questionBasis=completed_workload_total`. Ordinary effort questions remain single-target questions even if malformed or stale state happens to contain another workload identifier.

A direct answer about how long completed work took belongs to `questionTargetWorkload`. An explicit total duration for remaining work belongs to `estimateForWorkload`. An explicit per-unit pace for the work being estimated also belongs to `estimateForWorkload` when that second target exists.

Do not implement this distinction with raw Japanese keyword/regex routing. AI owns the meaning classification; deterministic code owns which typed workload a classified answer may bind to.

## Real Luna merge gate 19

Requested checkpoint: `20260819-pr157-merge-gate-19`
Implementation head at request: `ea0329f63b0f7c9a608213419fa26f2211efe89a`
Repetitions: 3
Result: 0/3 fully passed
Provider status: available; provider smoke returned HTTP 200 in all repetitions

The failures were application-level rather than quota/provider failures.

### Repetition 1

A valid remaining-duration reply in the final conversation fell through the focused contextual route into generic normalization and ultimately produced `stable_v5_normalization_rejected`.

### Repetition 2

Another remaining-duration reply also fell through focused handling. The dedicated remaining-effort scenario reached a superficially plausible conversation, but manual Fact Graph review found a hidden directionality defect: the active `total_duration=45` effort fact was attached to the completed 70% workload instead of the derived remaining 30% workload.

This is a merge blocker even though the visible assistant text described the remaining 30% as taking about 45 minutes.

### Repetition 3

The dedicated remaining-effort invariant passed, showing that the model could choose the intended meaning, but the final conversation failed a separate grounding requirement. After the user supplied a deadline of tomorrow at 13:00, the assistant resumed the progress question without observably acknowledging the 13:00 deadline.

Manual transcript review also found another hidden defect later in the bounded-slide scenario: after the user supplied an explicit pace of about 8 minutes per slide, the assistant acknowledged that pace but re-asked how long the already-completed 12 slides had taken. The pending `missing_effort_estimate` question therefore remained unresolved instead of applying the per-unit estimate to the remaining 8 slides.

Gate 19 demonstrated why green exit codes alone are insufficient: transcript wording and Fact Graph target identity must both be inspected.

## Repair after gate 19

The gate-19 repair kept the same architectural ownership instead of adding sentence-specific cases:

1. Focused contextual semantics explicitly accepted remaining-total and per-unit effort as alternate answers to a completed-work pace question when `estimateForWorkload` exists.
2. The distinct estimate target was exposed to focused semantics only under `questionBasis=completed_workload_total`, preventing dual-target behavior from leaking into ordinary pending effort questions.
3. A dual-target focused `fallback` received one focused repair pass before generic full-plan normalization.
4. Dialogue grounding validation began checking concrete clock values carried by acknowledged typed facts, and renderer repair was instructed to preserve them.
5. Prompt-budget guards were relaxed only enough to retain these typed invariants while remaining substantially smaller than the generic semantic path.

Deterministic CI and Browser Regression were green before gate 20.

## Real Luna merge gate 20

Requested checkpoint: `20260819-pr157-merge-gate-20`
Implementation head at request: `a99b2b760d8581010196aee56f359756495d2d06`
Repetitions: 3
Result: 0/3 fully passed
Provider status: available; provider smoke returned HTTP 200 in all repetitions

Gate 20 reproduced the directionality problem more clearly and exposed a separate renderer-metadata instability.

### Directionality failure

In two repetitions, a user reply meaning that the remaining work would take about two hours produced visibly plausible dialogue, but the Fact Graph stored the resulting `total_duration=120` effort estimate against the completed-work workload rather than the derived remaining workload.

The trace showed the exact failure chain:

1. the focused contextual classifier returned no usable typed document on both attempts;
2. generic normalization preserved the effort value but represented it as a task-shell effort estimate without a workload-level directional reference;
3. the deterministic contextual binder then defaulted this directionless total duration to the original pending target, which was completed work.

This means the corruption happened even though the visible assistant response referred to remaining work correctly. The same mechanism can affect the dedicated remaining-45-minute scenario. A directionless generic effort value is therefore not sufficient evidence to choose between completed and remaining targets.

### Renderer metadata failure

In two repetitions, the all-question-code matrix produced valid grounded visible text for `missing_effort_estimate`, but Luna also populated `groundingAcknowledgement` while `currentTurnGrounding.mode=none`. The previous validator treated any non-null ACK metadata in mode `none` as an error and failed closed, even though the metadata was unused and the visible text remained subject to the normal grounding and safety validators.

This is separate from the required-before-resume ACK contract. When the application says `required_before_resume`, accepted fact IDs and concrete values remain strict requirements.

## Current repair after gate 20

The next repair changes the typed interface rather than adding more wording exceptions.

### Orthogonal focused effort contract

Focused effort interpretation no longer asks Luna to choose overloaded decisions such as “remaining effort answer” versus “per-unit effort answer”. Instead a clear effort answer is represented by independent typed fields:

- `decision=effort_answer`;
- `effortTarget=question_target | estimate_target`;
- `effortMeasurement=total_duration | duration_per_unit`;
- `minutes` and `precision`.

This separates two semantic axes that were previously entangled: what workload the answer refers to, and how effort is measured. `estimate_target` is valid only when the typed pending state actually exposes `estimateForWorkload`; ordinary single-target questions cannot acquire it accidentally.

The one focused repair pass now asks the model to re-evaluate those two typed axes independently. It still contains no Japanese fixture strings and does not move meaning ownership into deterministic text heuristics.

### Fail closed on generic direction loss

If a generic fallback returns a total-duration effort value on a dual-target question but provides neither an explicit completed/remaining workload reference nor another typed directional signal, deterministic binding now returns no contextual target instead of silently selecting completed work.

Explicit remaining meaning still binds to `estimateForWorkload`; explicit completed meaning still binds to `questionTargetWorkload`; explicit per-unit effort remains eligible for the schedulable estimate target. Only the directionless ambiguous case is rejected from contextual binding.

A dedicated deterministic regression test now covers the exact gate-20 failure shape: task-shell total duration plus dual-target pending state must not default to completed evidence.

### Mode-none ACK metadata

When `currentTurnGrounding.mode=none`, `groundingAcknowledgement` is unused control metadata. A redundant well-formed ACK object is now ignored rather than treated as a contract failure, while the visible response still passes through ordinary safety, date/time grounding, execution-claim, preview, and repeated-question validation.

`recommended` and `required_before_resume` remain strict. In particular, required acknowledgements still have to reference accepted current-turn facts and preserve concrete clock values such as `13:00`.

The implementation then added deterministic coverage for generic explicit completed/remaining direction and updated the observed-pace integration fixture so its mocked 90-minute answer carries the same typed completed-work direction required in production. Deterministic CI was fully green on `153d1acd1e9838421991defba4ad03495c46b64c` before requesting gate 21.

## Real Luna merge gate 21

Requested checkpoint: `20260819-pr157-merge-gate-21`
Implementation head at request: `d04376eb89c1ff8d9811d9af201680441083416d`
Repetitions: 3
Result: 1/3 fully passed
Provider status: available; provider smoke returned HTTP 200 in all repetitions
Deterministic CI on the same head: green

Gate 21 confirmed that the gate-20 target-direction repair materially worked, but the PR remained merge-blocked by two independent semantic-orchestration failures in the final conversation.

### What remained stable

The dedicated remaining-effort test passed in both failed repetitions. In particular, explicit remaining duration was bound to the remaining progress fact rather than completed progress. The dedicated 100% completion test also passed, as did the typed renderer stress matrix and the all-question-code matrix. One of the three complete merge-gate repetitions passed end to end.

### Repetition 2: alternate 8 min/unit was lost

The bounded-slide conversation reached scope total 20 slides, corrected completed count 12, derived remaining count 8, then asked a completed-work total-duration question while exposing the remaining-8 workload as `estimateForWorkload`. The user supplied about 8 minutes per slide. Both focused contextual attempts errored, generic normalization returned no effort delta, and the pending question remained unresolved.

### Repetition 3: deadline retry boundary

The report conversation had an existing pending progress question when the user supplied `deadline = tomorrow 13:00`. A retry produced the intended deadline shape, but the response used a minimal existing task shell with `study=null`. The strict response schema permits that delta shape while the base semantic validator had required study metadata as if the existing task were new. This exposed a schema/delta-validation mismatch.

### Repair after gate 21

Two narrow architectural repairs followed:

- the focused contextual response token cap was raised from 140 to 320 because successful real responses were already consuming close to the old ceiling; prompt semantics were unchanged;
- a verified `existingPublicId` study-task delta shell may receive transient unknown study metadata before structural validation. The shell is filled only when public state confirms the existing study task, and existing-entity rebasing removes this transient context before commit.

A deterministic regression reproduces the exact deadline retry shape with `study=null`. CI and Browser Regression were green on implementation head `ffc968e2a978e60f97ee9d67cff6dc5f2888751a` before gate 22.

## Real Luna merge gate 22

Requested checkpoint: `20260819-pr157-merge-gate-22`
Gate head: `410a356a3ded560be6bdc9f1e673e0dae0e43a23`
Repetitions: 3
Result: 2/3 fully passed
Provider status: available; provider smoke returned HTTP 200 in all repetitions
Deterministic CI on the same head: green

Gate 22 shows that the gate-21 effort repair worked. The bounded-slide 8-minutes-per-unit path no longer failed in the merge-gate run, the dedicated remaining-effort gate remained green, the 100% completion gate remained green, and the typed renderer/all-question-code matrices remained green. Two complete final-conversation repetitions passed end to end.

### Remaining failure: deadline side contribution can still be lost as semantic no-op

The only failing repetition again occurred when the report conversation had a pending progress question and the user supplied a task deadline of tomorrow at 13:00. The final graph revision stayed unchanged, no temporal constraint was committed, and the assistant resumed the progress question without acknowledging 13:00.

This time the structural validator was not the cause. The initial generic semantic response and both completeness retries were schema-valid existing-task shells with no temporal constraint. In the successful repetition, the first completeness retry emitted the expected typed deadline and was immediately adopted. In the failed repetition, all three generic passes omitted the deadline despite explicit retry instructions.

The remaining defect is therefore stochastic semantic extraction under a pending question, not target binding, canonicalization, grounding validation, or schema validation. Repeating the same full semantic document request is not a sufficiently stable recovery mechanism for this side-contribution class.

### Gate-22 repair boundary

The next repair should add a small AI-owned focused temporal side-contribution route that is entered only from machine state: a schema-valid semantic no-op while a pending question and a resolvable existing task target are present. The route must ask whether the current turn contains a task-scoped temporal constraint and, if so, return its typed kind/date/time/constraint-level fields. Deterministic code may bind that typed result to the already-resolved existing task, but must not inspect Japanese words or infer temporal meaning from raw text.

If the focused temporal route returns fallback or uncertainty, the existing generic completeness retry remains available for other side-contribution classes. The focused route must be general across supported task temporal constraints rather than hard-coded to the 13:00 fixture.

## Prohibited fixes

Do not solve these regressions by:

- adding raw Japanese keyword/regex semantic routing;
- adding sentence-specific branches for the failing fixtures;
- deleting the typed completed/remaining distinction;
- weakening canonicalization or silently accepting an incompatible target;
- treating visually plausible assistant prose as proof that the Fact Graph is correct;
- rolling back semantic rules merely to recover a previous prompt budget;
- replacing AI-owned semantic interpretation with deterministic text heuristics.

## Final acceptance

Before merge:

- deterministic CI and Browser Regression are green on the exact final branch state;
- the seven earlier deterministic regressions remain resolved;
- repeated real-Luna merge-gate runs complete successfully on that same implementation state;
- visible transcripts and resulting Fact Graph/application state are reviewed, not only the workflow exit code;
- direct completed-work answers bind to the question workload, while explicit remaining/per-unit measurements bind to the intended schedulable workload;
- directionless generic effort on a dual-target question never silently defaults to completed work;
- a valid alternate remaining/per-unit effort answer resolves the pending effort question instead of being acknowledged and then re-asked;
- open-ended progress does not invent page/slide/problem totals;
- fixed totals and explicit quantities remain exact;
- side contributions are preserved and observably acknowledged before the prior pending question resumes, including concrete clock values when supplied;
- `mode=none` does not fail solely because the renderer emitted redundant unused ACK metadata;
- 100% completion does not ask the same progress question again;
- correction from completed to incomplete reopens remaining work correctly;
- percentage to exact-quantity transition does not double-schedule;
- all runtime question classes receive a safe typed intent;
- no raw Japanese semantic keyword/regex routing or fixed normal-path Japanese response is added to make the audit pass;
- canonical status, roadmap, docs index, PR description, and this task reflect the final state.

If a real-Luna run exposes a meaningful defect, stop the merge path, add deterministic regression coverage where possible, fix the owning layer generally, and rerun from the same gate.

## Next gate

After the gate-22 temporal side-contribution defect is fixed and deterministic CI plus Browser Regression are green, request a fresh 3x Real Luna merge gate. Manual review must specifically inspect:

- open-ended 60% progress → remaining 40% → explicit remaining duration;
- deadline side contribution → concrete deadline acknowledgement → resumed progress question;
- bounded total 20 → completed correction 10→12 → remaining 8 → explicit 8 min/unit bound to remaining 8 with no repeated completed-total question;
- open-ended 70% → remaining 30% → remaining 45 minutes bound to remaining 30%;
- final remaining-duration answer such as two hours binds to the remaining workload rather than completed evidence;
- all-question-code renderer matrix remains stable when `currentTurnGrounding.mode=none`;
- 100% completion behavior;
- typed renderer and all runtime question-code matrices.

## Stop condition for PR #157

PR #157 ends when the typed pending-question boundary is internally consistent, deterministic CI and Browser Regression are green, the final Real Luna merge gate passes repeatedly with transcript/Fact Graph review, and the PR documentation matches the validated head. New homepage work and unrelated refactoring are outside this PR.

## After merge

Close Issue #156, remove the PR branch after confirming main contains the merge, then continue with the next independent priority. Issue #115 and Issue #52 remain separate scopes.
