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
- Exact verified HEAD before this checkpoint commit: `7ddc674755094c4ec041639ba09de0164d3608c9`
- `main` HEAD incorporated into the branch: `e7618109172bd8a412baa31045884e6fedcc9712`
- Branch comparison after the merge commit: ahead of `main`, behind by 0
- PR #162 still has a historical validation-only title/body that says not to merge. Reconcile title/body/draft status only after the exact current HEAD satisfies the automated and UI gates below.

## Process contract

Read the `Mandatory execution discipline` section at the top of `AGENTS.md` before resuming.

In particular:

- compare multiple plausible hypotheses/actions when evidence is incomplete
- do not repeat the same failed operation blindly
- after two materially identical failures, switch evidence source or method instead of a third identical attempt
- treat skipped/truncated/missing tool output as missing evidence
- use the exact current HEAD for every readiness claim
- continue implement → verify → inspect → correct until the exit criteria are satisfied or a genuine blocker requires the user

## Completed work relevant to merge readiness

The branch contains the broader Home/UI redesign plus recent dark-mode, motion, accessibility, schedule-strip, quick-add, and persistent primary-chrome work.

Recent Browser Regression repair loop:

1. Home-page locators were colliding with the persistent header because the same Home style-context classes are intentionally reused by chrome. Production classes were preserved; E2E Home locators were scoped to the actual `.home-main` page body instead.
2. `学習を追加` is intentionally manual-only. Weekly AI lifecycle browser coverage was preserved by wiring the real-weekly test harness directly to the generic AI-capable modal instead of restoring AI controls to the production manual-only wrapper.
3. Primary-chrome tests were corrected so active-nav decoration is not mistaken for a fixed chrome dimension.
4. Theme regression navigation was aligned with the current `詳細を見る` analysis entry instead of a removed primary-nav item.
5. Browser Regression on `aa223bc589b149a6d9a52e8ecf6ce303bae8b545` reduced to nine evidence-backed failures. Artifact inspection separated three causes:
   - AI planning moved the persistent header upward on short desktop heights because of an AI-only `padding-top: 5px` override.
   - Tall/wide Home layouts exhausted dynamic relaxation caps while leaving 24–45 px of avoidable space above bottom navigation.
   - Very constrained heights intentionally use internal vertical scrolling for `今日の予定`, but the old single-plan regression prohibited any scroll even when the tail remained reachable.
6. Root-cause fixes applied:
   - removed the AI-only short-height top-padding override so Home and AI preserve the same header Y position;
   - raised only the existing dynamic Home hero expansion caps (`234 / 318 / 350`) so spare viewport height can be consumed by the existing fitter instead of breakpoint hacks;
   - changed the constrained-height schedule regression to require that overflow is scrollable and the `この先の予定を追加` tail is reachable after scrolling, rather than requiring zero overflow.
7. Current `main` was two documentation commits ahead. The branch already contained the newer `AGENTS.md` discipline and additionally needed the new client-first requirements document. A two-parent merge commit was created with branch `AGENTS.md` preserved and the new canonical requirements document added. No production code was changed by the main sync.

## Verification evidence so far

Do not use these historical results as final certification for a newer HEAD.

- Normal CI was green on `aa223bc589b149a6d9a52e8ecf6ce303bae8b545` before the latest three Browser Regression fixes.
- Browser Regression #1343 on that same HEAD failed with nine unique failures; those failures were inspected through the uploaded Playwright artifact rather than inferred from job status alone.
- The three latest functional/test fixes were diff-audited against `aa223bc...`: only `HomeView.tsx`, `ai-planning-page.css`, and `home-layout-responsive.spec.mjs` changed.
- Main synchronization was diff-audited: relative to the pre-merge branch tree it added only `docs/ai/tasks/20260822-client-first-execution-requirements.md`; branch `AGENTS.md` content was preserved.
- PR #162 currently has no submitted reviews and no review threads, so there is no known review-thread blocker.

## Required next actions

1. Re-fetch PR #162 after this checkpoint commit and record the exact current HEAD.
2. Fetch CI and Browser Regression for that exact HEAD only.
3. If Browser Regression fails, download that run's artifact and classify the remaining failures from concrete error contexts/screenshots/traces before editing.
4. If CI fails, inspect the exact failed job/log and fix the underlying defect rather than rerunning blindly.
5. Repeat implement → verify → artifact inspection until both gates are green on the same HEAD.
6. Reconfirm `main` has not advanced; if it has, integrate it without rewriting shared history and rerun exact-HEAD gates.
7. Reconfirm GitHub mergeability and that review/review-thread blockers remain absent.
8. Reconcile PR #162 title/body with the actual UI redesign scope and remove the validation-only/do-not-merge wording.
9. Mark the PR ready for review only after all merge-readiness gates are satisfied.
10. Do not execute the final merge until the user explicitly instructs to merge.

## Definition of done / exit criteria

Do not call this branch merge-ready until all applicable criteria are satisfied on the same exact current HEAD:

- no unresolved merge conflict
- branch is not behind current `main`
- TypeScript/type checks pass
- relevant unit/integration tests pass
- production build passes
- normal CI passes
- Browser Regression passes, or a specific non-product infrastructure failure is independently proven and documented rather than guessed
- no known high-severity UI regression remains from the requested audit scope
- dark mode and responsive behavior for the recently changed surfaces are covered by the current browser regression/audit evidence
- current diff has been inspected for accidental/unrelated breakage
- no blocking review or unresolved review thread remains
- PR metadata no longer contradicts the actual intent to merge
- PR is no longer draft

If any criterion is not satisfied, continue the repair/verification loop instead of ending with a status-only response.
