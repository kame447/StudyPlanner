# Home add menu: touch, motion and palette

Status: local candidate verified and independently source-reviewed under [Issue #483](https://github.com/kame447/StudyPlanner/issues/483). Latest main is integrated and locally verified; browser/visual CI remains pending; no publication, merge or deployment performed.

- Local branch: `ui/home-add-motion-theme`.
- Initial base: `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`; verified current main base: `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`.
- [PR #601](https://github.com/kame447/StudyPlanner/pull/601) was already merged. Current Issue checkpoints, related open/closed PRs and branches were checked before this requested continuation. No overlapping active PR was found, and no new Issue/PR or branch deletion was performed.
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

## Remaining acceptance

Local Chromium cannot start (`socket()` denied, including one reviewed escalated attempt); official WebKit lacks host libraries. Native browser, screenshots, physical iOS and authenticated production behavior are unverified.

After authorized draft publication, run the existing full gates plus:
1. Existing Home 13 geometry/form cases and the 28 new Chromium cases: both fade directions, interruption, reduced motion, full-row taps during closing, all five palettes × light/dark × standard/pixel, native touch, save/reload and cancellation.
2. Mobile WebKit's three new native-touch/keyboard cases, inspecting the recorded event-order artifacts.
3. Existing responsive/focus and four visual projects. Review the intended Home color change and update only the four Home goldens when justified by actual images; do not mask the control or loosen tolerances. Other surface goldens are unchanged.
4. Fresh combined verification if later main changes or other requested UI work are integrated. Further CSS additions must stay within the unchanged guards.

Keep this single release unit for the touch fix and requested motion/theme improvement. No production-fix or merge-ready claim before those pending gates complete.
