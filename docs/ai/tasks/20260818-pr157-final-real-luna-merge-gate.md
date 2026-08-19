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

The routing fix now identifies independent meaning from typed semantic content rather than task identity alone. It preserves genuine deadlines, recurrence/context changes, remaining/completed workload changes, target-only new work, and new components through normal canonicalization while allowing a temporary effort-answer shell to bind to the exact pending target.

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

## Current repair after gate 19

The current repair keeps the same architectural ownership instead of adding sentence-specific cases:

1. Focused contextual semantics explicitly define remaining-total and per-unit effort as valid alternate answers to a completed-work pace question when `estimateForWorkload` exists.
2. The distinct estimate target is exposed to focused semantics only under `questionBasis=completed_workload_total`, preventing dual-target behavior from leaking into ordinary pending effort questions.
3. If the first focused classification returns `fallback` on this typed dual-target state, the semantic layer performs one focused repair pass before falling back to the generic full-plan normalizer. The repair instruction restates only the typed contract; it contains no Japanese fixture wording.
4. Deterministic regression coverage now checks fallback → focused repair → remaining target binding and direct per-unit binding to the schedulable workload.
5. Dialogue grounding validation now checks concrete clock values carried by acknowledged typed facts. An ACK that claims a deadline fact but drops its 13:00 value is rejected and receives one renderer repair pass that explicitly preserves concrete values.
6. The clock check compares normalized clock values, so equivalent forms such as `13:00` and `13時`, or `14:30` and `14時半`, are treated as the same time rather than relying on one fixed Japanese surface form.

The current repair is not merge-ready until its exact head passes deterministic CI and Browser Regression, followed by a fresh repeated Real Luna merge gate.

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
- a valid alternate remaining/per-unit effort answer resolves the pending effort question instead of being acknowledged and then re-asked;
- open-ended progress does not invent page/slide/problem totals;
- fixed totals and explicit quantities remain exact;
- side contributions are preserved and observably acknowledged before the prior pending question resumes, including concrete clock values when supplied;
- 100% completion does not ask the same progress question again;
- correction from completed to incomplete reopens remaining work correctly;
- percentage to exact-quantity transition does not double-schedule;
- all runtime question classes receive a safe typed intent;
- no raw Japanese semantic keyword/regex routing or fixed normal-path Japanese response is added to make the audit pass;
- canonical status, roadmap, docs index, PR description, and this task reflect the final state.

If a real-Luna run exposes a meaningful defect, stop the merge path, add deterministic regression coverage where possible, fix the owning layer generally, and rerun from the same gate.

## Next gate

After deterministic CI and Browser Regression are green on the current repair, request a fresh 3x Real Luna merge gate. Manual review must specifically inspect:

- open-ended 60% progress → remaining 40% → explicit remaining duration;
- deadline side contribution → concrete deadline acknowledgement → resumed progress question;
- bounded total 20 → completed correction 10→12 → remaining 8 → explicit 8 min/unit bound to remaining 8 with no repeated completed-total question;
- open-ended 70% → remaining 30% → remaining 45 minutes bound to remaining 30%;
- 100% completion behavior;
- typed renderer and all runtime question-code matrices.

## Stop condition for PR #157

PR #157 ends when the typed pending-question boundary is internally consistent, deterministic CI and Browser Regression are green, the final Real Luna merge gate passes repeatedly with transcript/Fact Graph review, and the PR documentation matches the validated head. New homepage work and unrelated refactoring are outside this PR.

## After merge

Close Issue #156, remove the PR branch after confirming main contains the merge, then continue with the next independent priority. Issue #115 and Issue #52 remain separate scopes.
