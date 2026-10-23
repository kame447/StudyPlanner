# Home add menu: touch, motion and palette

Status: [draft PR #609](https://github.com/kame447/StudyPlanner/pull/609), under [Issue #483](https://github.com/kame447/StudyPlanner/issues/483). Initial browser acceptance passed; four reviewed Home golden updates are locally verified and await publication plus exact-head visual CI. No main merge or deployment performed.

- Local branch: `ui/home-add-motion-theme`.
- Initial base: `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`; verified current main base: `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`.
- [PR #601](https://github.com/kame447/StudyPlanner/pull/601) was already merged. Current Issue checkpoints, related open/closed PRs and branches were checked before the requested continuation. PR #609 now owns this release unit; no new Issue, replacement PR or branch deletion.
- Normal merge of current main completed without conflict. Verified implementation HEAD: `10842bc527c46dffab81f3d7892bbd6371118b7d`, tree `ec503a2053d20d54e71ecf0ec92ef6b16b1773be`. The final follow-up commit changes only this verification record.

## Change

The native event/study buttons remain mounted for reversible 180ms fades. Closed buttons are disabled, aria-hidden and excluded from pointer hit testing immediately, then become invisible after fading. Opening makes them visible immediately for the existing first-action focus. Explicit columns prevent an implicit fourth Grid track while the collapsed trigger spans the full row.

One Plus rotates to X over 240ms using Calendar's motion curve. Reduced motion makes both changes immediate. Calendar accent/surface colors and the existing pixel primary-button paint replace inherited gray/fixed-blue assumptions. Existing row sizing, date/form handoff, Escape, known outside focus and outside-pointer dismissal remain.

Safari can drop focus to the document before an internal touch dispatches click. The blur handler now distinguishes that null target from a known outside focus target. This Home change does not alter save, auth, schema or Firestore rules.

## Causal regression and review

- Untouched main plus the new event-sequence test: one expected failure / one pass. Internal pointer → null blur removed the study target before click.
- Retaining animation nodes but reverting only the null-target guard still failed because the target became disabled. Restoring the guard passed both cases, separating the fix from motion.
- Existing menu/Home flow and palette-focused checks: 47 passed.
- Independent source review found and fixed an implicit Grid column and fading disabled buttons intercepting rapid reopen. The browser regression now measures full-row collapsed bounds and actual midpoint hit testing.
- A new fixture initially reached onboarding because all collections were empty. The corrected shared fixture seeds one open, unscheduled Todo while Today starts empty. Its real init callback and reload-preservation probe pass.

## Final local verification

One-worker `npm run verify` completed with fresh non-incremental app/Worker typechecks, Worker type generation, **830 files / 7,645 tests passed**, and production build exit 0. The 54 skipped tests / one todo are excluded, including nine upstream PR #602 tests that require the separate Firestore emulator gate. The 1,989 runtime/test/config inputs and 235 installed dependency identities matched before/after; no installed version mismatch. Node 24.19.0 / Vitest 3.2.7. `DEV_LAN_HOST=127.0.0.1` avoids the environment's network-enumeration error without changing repository configuration.

- All CSS and optional-pixel guards pass: total **492,683** / largest **424,981** raw bytes; gzip total 83,675 / largest 69,164. Pixel CSS 7,077; font 500,340.
- Existing aggregate JS overage remains: 2,342,903 raw / 631,165 gzip. The overall budget command exits 1; this is not all-gates-green. No threshold changed. Largest CSS has only **19 bytes** of headroom.
- Browser collection passes: 24 motion/theme cases, four native-touch/keyboard/cancel cases in Chromium, and three mobile WebKit cases. Local collection used Playwright 1.62.1, not the CI-pinned browser version. Collection is not execution evidence.
- Raw logs, input manifests, mutation/control receipts and fixture proof are retained outside the PR by the integration owner.

## Initial PR browser acceptance and golden update

Published head `8aa9b222397f013c530b1c5e6c8d20baedb29a3d`; CI merge `55aed9c5ba07cdd18d0b710ad36130817fcfa8cb` has the exact verified tree `04b9fd1b58a317e2c0890e59e9fc7ed21fccb805`.

- [Core CI](https://github.com/kame447/StudyPlanner/actions/runs/38362145062): fresh types, 7,645 tests, existing Firestore Rules script and build passed. The upstream approval emulator's nine skipped tests are not exercised by that separate Rules script.
- [Chromium](https://github.com/kame447/StudyPlanner/actions/runs/38362144712): 605 passed, no flaky tests, including all 41 Home add cases. Twenty actual palette PNGs were inspected; labels, icons and central close control remain contained. Motion midpoint, reversal, reduced motion and full-row hit tests passed.
- [Cross-browser](https://github.com/kame447/StudyPlanner/actions/runs/38362144689): Chromium 68 / Firefox 68 / WebKit desktop 72 / mobile 210 passed, six existing skips. Three mobile Home cases passed without retry. Recorded native touch opened/saved/reloaded both widths; cancellation recorded trusted pointercancel without click. Headless WebKit used internal BUTTON focus, not null-target blur; the causal null-blur proof remains the separate unit/mutation test.
- [Admin](https://github.com/kame447/StudyPlanner/actions/runs/38362144687) 45 and [browser quality](https://github.com/kame447/StudyPlanner/actions/runs/38362144855) five passed. CSS guard passed; pre-existing aggregate JS overage remains.
- Initial visual failed only on four Home images. Both reviewers inspected actual/diff PNGs from artifact `11795178545` (ZIP SHA-256 `924d099b407777affe44a44724fd880bbc8729ddaf249ebe9ef41d8c5839fcf2`). Mobile differences are the add-row paint only. Desktop goldens also predate already-adopted CTA wording and pre-start student removal; source/history confirmed those residuals. All four attempt/retry pairs are byte identical. Only the four untouched CI actual Home PNGs are adopted; no other goldens, masks or tolerances changed.
- After these four image updates, final local `npm run verify` again passed fresh types, 830 files / 7,645 tests (54 skips / one todo excluded), and build. All 2,403 tracked/unignored input hashes and 235 installed package identities matched before/after. The only subsequent change is this record.

Next: publish this same PR's reviewed golden update and verify its exact-head CI, especially all four visual projects. Physical iOS and authenticated production remain unverified. Local Chromium/WebKit launch restrictions were not retried. Further integration needs its own exact-content proof; no main or production-fix claim yet.
