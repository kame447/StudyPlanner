# PR #157 final Real Luna merge gate

Status: active / merge blocked
Updated: 2026-08-19
Branch: `agent/issue156-prompt-simplification-adversarial-audit`
Issue: #156
PR: #157

## Purpose

Finish the adversarial follow-up to PR #130 without adding sentence-specific patches. The final gate verifies that typed application decisions, human grounding, progress/correction handling, and dialogue realization agree under deterministic CI, browser regression, and repeated real `gpt-5.6-luna` runs.

## Current checkpoint

The pre-documentation implementation checkpoint was `6fa31b95358fbf8019e22f349cf35ca71638565b`.

At that checkpoint:

- Browser Regression is green.
- CI is red: 1729 tests passed and 7 tests failed.
- Prompt-budget tests are green; the current failure is not a prompt-budget problem.
- The `Weekly Planning Real API Checkpoint` workflow is reported as successful overall, but its `real-api` job was skipped. Therefore the current implementation has not passed the Real Luna gate.
- The PR description still references an older head and must be refreshed only after the final implementation checkpoint is validated.

The seven deterministic failures are concentrated around the pending-question / contextual-answer boundary:

1. three conversation flows that should reach `draft_ready` instead remain at `needs_scope`;
2. one accepted pace-calibration flow no longer records its pending calibration session;
3. one incompatible contextual answer mutates the Fact Graph when it should be rejected atomically;
4. one short reply with a disappeared pending target returns `scheduler_needs_resolution` instead of `canonicalization_rejected`;
5. one ordinary task → short duration → creation-authorization flow rejects the duration turn.

## Current repair boundary

The recent work introduced two distinct typed workload references for progress-derived pace questions:

- the workload fact used as the basis of the question, such as already-completed work;
- the workload fact that is actually being estimated and scheduled, such as the derived remaining work.

That distinction is required. A direct answer about completed work must remain attached to the question basis, while an explicit alternate measurement such as remaining duration or per-unit pace must be able to attach to the schedulable remaining workload.

The next fix must preserve that distinction while narrowing where it applies. Ordinary pending duration/effort questions must continue to use their existing single-target path. The dual-target behavior must not globally reinterpret short answers, suppress calibration state, or weaken canonicalization atomicity.

Do not solve these regressions by:

- adding raw Japanese keyword/regex routing;
- adding sentence-specific branches for the failing fixtures;
- deleting the typed completed/remaining distinction;
- weakening canonicalization or silently accepting an incompatible target;
- rolling back semantic rules merely to recover the previous prompt budget.

## Final acceptance

Before merge:

- deterministic CI and Browser Regression are green on the exact final branch state;
- all seven current deterministic regressions are resolved by the owning semantic/application layer rather than fixture-specific patches;
- repeated real-Luna merge-gate runs complete successfully on that same implementation state;
- visible transcripts and resulting Fact Graph/application state are reviewed, not only the workflow exit code;
- direct completed-work answers bind to the question workload, while explicit remaining/per-unit measurements bind to the intended schedulable workload;
- open-ended progress does not invent page/slide/problem totals;
- fixed totals and explicit quantities remain exact;
- side contributions are preserved and acknowledged before the prior pending question resumes;
- 100% completion does not ask the same progress question again;
- correction from completed to incomplete reopens remaining work correctly;
- percentage to exact-quantity transition does not double-schedule;
- all runtime question classes receive a safe typed intent;
- no raw Japanese semantic keyword/regex routing or fixed normal-path Japanese response is added to make the audit pass;
- canonical status, roadmap, docs index, PR description, and this task reflect the final state.

If a real-Luna run exposes a meaningful defect, stop the merge path, add deterministic regression coverage where possible, fix the owning layer generally, and rerun from the same gate.

## Stop condition for PR #157

PR #157 ends when the typed pending-question boundary is internally consistent, deterministic CI and Browser Regression are green, the final Real Luna merge gate passes repeatedly with transcript/Fact Graph review, and the PR documentation matches the validated head. New homepage work and unrelated refactoring are outside this PR.

## After merge

Close Issue #156, remove the PR branch after confirming main contains the merge, then continue with the next independent priority. Issue #115 and Issue #52 remain separate scopes.
