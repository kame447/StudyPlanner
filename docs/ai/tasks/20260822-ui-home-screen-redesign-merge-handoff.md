# UI home-screen redesign merge-readiness handoff

Status: active
Date: 2026-08-22

## User objective

Continue fixing and verifying `ui/home-screen-redesign` until it is genuinely safe to merge and test in production. Do not stop at an intermediate status update when repair/verification can continue without user input.

## Active repository state

- Repository: `kame447/StudyPlanner`
- Branch: `ui/home-screen-redesign`
- Pull request: #162
- PR state at this checkpoint: open, draft, mergeable by GitHub metadata
- Exact verified HEAD before this handoff commit: `16f9b0b85f4bb6dbd7a0d791c43e5ccdc6241c3e`
- PR #162 currently has a historical validation-only title/body that says not to merge. Do not treat that text as proof that the branch is merge-ready; reconcile PR purpose/title/body only after the branch satisfies the real merge-readiness criteria.

## Process contract

Read the `Mandatory execution discipline` section at the top of `AGENTS.md` before resuming.

In particular:

- compare multiple plausible hypotheses/actions when evidence is incomplete
- do not repeat the same failed operation blindly
- after two materially identical failures, switch evidence source or method instead of a third identical attempt
- treat skipped/truncated/missing tool output as missing evidence
- use the exact current HEAD for every readiness claim
- continue implement → verify → inspect → correct until the exit criteria are satisfied or a genuine blocker requires the user

## Completed UI work relevant to the current branch

The branch already contains substantial UI work, including the recent day-strip/quick-add changes, motion/accessibility work, dark-mode surface work, and the latest dark-mode gradient adjustment for the Home `次の予定` card. Do not assume these are correct merely because they were implemented; verify current rendered behavior and regression coverage.

The latest process hardening also added the mandatory adversarial/repeat-action protocol to root `AGENTS.md`.

## Verification state

Do not reconstruct CI state from memory.

At the time this handoff was written, the HEAD changed because of repository-instruction commits, so previous CI/browser results are not sufficient to certify the current HEAD. Re-fetch the workflow/check state for the exact current HEAD before making any merge-readiness claim.

Known historical signal only:

- normal CI had passed on an earlier UI HEAD during this work
- Browser Regression had previously been a remaining/failing gate on an earlier HEAD
- therefore browser regression must be inspected again on the exact current HEAD rather than assumed green or assumed broken

## Required next actions

1. Re-fetch PR #162 and record the exact current HEAD.
2. Fetch workflow/check runs for that exact HEAD.
3. If a relevant check fails, collect concrete failure evidence before changing code.
4. For each failure, compare at least three plausible causes when ambiguity exists: production defect, stale/incorrect test contract, harness/environment defect, infrastructure/transient failure, or another evidence-backed alternative.
5. Apply the smallest root-cause fix that preserves the intended product contract.
6. Re-run/re-check the exact latest HEAD.
7. Repeat until all relevant automated gates are green.
8. Re-audit the changed UI at least across: visual/theme, responsive/safe-area, navigation/interactions/motion, accessibility, performance, maintainability, regression/release safety.
9. Where practical, inspect rendered browser output rather than relying only on source/CSS assertions.
10. Reconcile PR #162 title/body/draft status with the actual merge intent only after the branch is ready.

## Definition of done / exit criteria

Do not call this branch merge-ready until all applicable criteria are satisfied on the same exact current HEAD:

- no unresolved merge conflict
- TypeScript/type checks pass
- relevant unit/integration tests pass
- production build passes
- normal CI passes
- Browser Regression passes, or a specific non-product infrastructure failure is independently proven and documented rather than guessed
- no known high-severity UI regression remains from the requested audit scope
- dark mode and responsive behavior for the recently changed surfaces are verified
- current diff has been inspected for accidental/unrelated breakage
- PR metadata no longer contradicts the actual intent to merge

If any criterion is not satisfied, continue the repair/verification loop instead of ending with a status-only response.
