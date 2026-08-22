# UI home-screen redesign merge-readiness handoff

Status: final verification
Date: 2026-08-22

## User objective

Continue fixing and verifying `ui/home-screen-redesign` until it is genuinely safe to merge. Do not stop at an intermediate status update while repair or verification can continue without user input. Do not execute the final merge until the user explicitly asks for it.

## Active repository state

- Repository: `kame447/StudyPlanner`
- Branch: `ui/home-screen-redesign`
- Pull request: #162
- Current base: `main`
- Latest verified functional HEAD before this checkpoint commit: `7b8fa914167a5ad5cd2a698f69a1fd9e0f65fc21`
- Incorporated `main` HEAD: `e7618109172bd8a412baa31045884e6fedcc9712`
- Branch comparison at the latest verification: ahead of `main`, behind by 0
- GitHub mergeability at the latest verification: mergeable
- Submitted reviews: 0
- Review threads: 0
- PR metadata is still historical validation-only text and the PR is still draft. This is the final non-code reconciliation after exact-HEAD verification.

## Process contract

Read the `Mandatory execution discipline` section at the top of `AGENTS.md` before resuming. In particular:

- compare materially different hypotheses/actions when evidence is incomplete
- do not blindly repeat a failed operation
- skipped/truncated/missing output is missing evidence
- use the exact current HEAD for readiness claims
- classify failures before editing production code or tests
- never weaken a regression merely to obtain green CI
- continue implement → verify → inspect → correct until the exit criteria are satisfied or a genuine external blocker requires user input

## Repair loop completed

The branch contains the broader Home/UI redesign plus dark-mode, responsive, motion, accessibility, quick-add, schedule, timetable, bookshelf, AI-planning and persistent primary-chrome work.

The Browser Regression repair loop identified and corrected the following evidence-backed causes:

1. Home page locators collided with persistent header style-context classes. Production styling contracts were retained and E2E Home locators were scoped to the actual `.home-main` page body.
2. `学習を追加` is intentionally manual-only. Weekly AI lifecycle coverage was preserved in the dedicated real-weekly harness instead of restoring AI controls to the product quick-add wrapper.
3. Primary-chrome tests no longer mistake route-specific active-nav decoration for a fixed chrome dimension.
4. Short-height AI planning no longer applies an AI-only top padding that moves the persistent header relative to Home.
5. Very constrained Home heights may use internal vertical scrolling for `今日の予定`; the regression now verifies that overflow is genuinely scrollable and the `この先の予定を追加` tail remains reachable rather than banning all overflow.
6. Tall Home layouts now remeasure after dynamic relaxation is applied. The fitter performs a bounded convergence pass rather than estimating once and leaving avoidable bottom whitespace. `home-layout-stability` verifies that it settles instead of oscillating.
7. Wide desktop Schedule now shares the same >=900px shell width/padding/bottom-nav contract as Home, removing the 20px persistent-header horizontal shift at 1280x720.
8. The final iPad portrait defect was a roughly 4px internal schedule-list overflow caused by exhausting the wide-tall row-side relaxation cap. The cap was reduced from 12px to 11px so the available height is redistributed to section spacing without clipping the add row.
9. Current `main` documentation commits were incorporated with a two-parent merge commit; the branch is no longer behind `main`.

## Verified automated evidence

On functional HEAD `7b8fa914167a5ad5cd2a698f69a1fd9e0f65fc21`:

- CI #4076: success
  - TypeScript checks: success
  - unit/integration tests: success
  - production build: success
  - PR diff check: success
- Browser Regression #1351: success
  - 150 / 150 Chromium tests passed
  - production bundle built successfully before the browser suite

The passing browser suite includes evidence for:

- browser accessibility contracts
- Quick Add keyboard navigation
- timetable keyboard operability
- phone/tablet/desktop/QHD responsive containment
- tablet portrait and landscape Home layouts
- resize transitions across device classes
- Home fitter stability/non-oscillation
- persistent chrome consistency across Home, AI planning, Schedule, Bookshelf and Timetable at mobile, desktop and tablet sizes
- dark theme and accent palette consistency plus persistence across reload
- bottom-sheet/quick-add motion flows
- weekly planning concurrency, persistence, approval races, failure recovery and rendering security

## Rendered visual audit

The uploaded Browser Regression #1351 artifact was opened and inspected rather than relying only on assertions.

Checked examples:

- desktop 1280x720 Home and Schedule: primary header/shell widths align; no visible horizontal chrome jump
- tablet 1024x1366 Home: major cards remain bounded, readable and visually balanced; no visible clipping at the repaired schedule/add-row boundary
- dark-ocean mobile Home: the next-plan dark artwork blends into its surface without the previous rectangular seam
- dark-ocean mobile Schedule, AI planning and Bookshelf: surfaces, borders, navigation and contrast remain coherent with no obvious clipping or mismatched light surfaces

No high-severity visual regression was found in the requested audit scope.

## Seven-view final audit

1. Visual/theme: pass on automated theme regression plus artifact inspection.
2. Responsive/safe-area: pass across the browser matrix and dedicated containment/device tests.
3. Navigation/interactions/motion: pass for persistent chrome, Quick Add, day sheet and primary surface transitions.
4. Accessibility: pass for browser accessibility contracts, keyboard Quick Add, timetable keyboard access and relevant modal/control paths. Some broader focus-hook consolidation remains maintainability work, not a current blocking regression.
5. Performance: production build succeeds. Vendor splitting is present. Known debt remains: the main application chunk is about 849.7 kB minified / 229.5 kB gzip and Vite still emits the >500 kB warning. This predates the final merge-readiness fixes and is tracked as non-blocking optimization debt; do not claim bundle optimization is complete.
6. Maintainability: the responsive fitter remains complex but the new convergence path is bounded and has explicit stability regression coverage. No refactor is required merely to move code before this merge.
7. Regression/release safety: CI and 150-test Browser Regression both passed on the same functional HEAD; branch was behind `main` by 0 and GitHub reported mergeable.

## Remaining actions

Because this checkpoint update itself creates a new documentation-only HEAD, do not reuse the previous green runs as final certification.

1. Re-fetch the exact new HEAD created by this checkpoint.
2. Confirm `main` has not advanced and branch remains behind by 0.
3. Require CI and Browser Regression to be green on that exact final HEAD.
4. Reconfirm mergeability and no review/review-thread blockers.
5. Replace PR #162's historical validation-only title/body with an accurate summary of the accumulated UI redesign/hardening scope.
6. Mark PR #162 ready for review.
7. Re-fetch PR/check state after the metadata transition.
8. Report merge-ready only if all conditions remain satisfied.
9. Do not merge until the user explicitly asks to merge.

## Definition of done / exit criteria

The branch is merge-ready only when all applicable criteria are simultaneously true on the final exact HEAD:

- no unresolved merge conflict
- branch is not behind current `main`
- TypeScript/type checks pass
- relevant unit/integration tests pass
- production build passes
- normal CI passes
- Browser Regression passes
- no known high-severity UI regression remains from the requested audit scope
- dark mode and responsive behavior are supported by current automated/rendered evidence
- current diff has been inspected for accidental breakage
- no blocking review or unresolved review thread remains
- PR metadata describes the actual merge intent and no longer says `Do not merge`
- PR is no longer draft

If any criterion is not satisfied, continue the repair/verification loop instead of ending with a status-only response.
