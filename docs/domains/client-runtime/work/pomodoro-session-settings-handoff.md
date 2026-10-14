# Pomodoro session settings handoff

Status: local implementation and exact-content verification complete on main 05c78b6; browser/remote and bundle-budget acceptance remain open. Not published.

## Ownership and scope

- Existing scope owner: [Issue #190](https://github.com/kame447/StudyPlanner/issues/190), open, with no comments or active implementation at the 2026-10-13 preflight.
- Active branch: `feat/pomodoro-session-settings`; initial base `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`, matching GitHub main at preflight. Final local feature commit uses base `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`; its exact hash is stored in the durable local `commit-receipt.json`. No remote branch or PR created.
- Scope: add 50/10 alongside 25/5 and editable set count through a separate session settings screen. Keep normal timer, explicit start, break-inclusive Actual duration, and current per-session ownership. No backend, schema, AI, persistence, or new dependencies.
- Domain worker owns `src/lib/pomodoroSession*`, narrow `actualTracking` transition helpers/tests, and this checkpoint. UI worker owns `StudySessionView`, separate settings component, styles, and component/browser tests. Shared worktree, nonoverlapping file ownership.

## Behavior decisions

- A set includes concentration and its final break. Selecting an explicit 1–12 sets stops elapsed measurement when all cycles finish; delayed ticks or Finish clicks cannot overcount. Completion stays on the timer, awaiting the user's existing Finish/record action. It never saves automatically.
- `setCount: null` preserves automatic plan-derived goals or unplanned unlimited measurement. An automatic displayed goal continues to use the legacy manual-finish contract.
- Settings remain specific to the current session; no existing persisted active-session/settings representation exists to migrate. A fresh session uses the existing 25/5 and automatic/unlimited defaults.
- Resolve settings to a value snapshot on Start; later input changes must never alter an active timer.
- Both focus and break count toward Actual duration; pauses do not. This preserves Issue #190's explicit existing accounting contract.

## Domain implementation and evidence

Changed domain files:

- `src/lib/pomodoroSession.ts`: preset/count validation, resolved settings snapshot, pure phase/completion and capped-elapsed projection, plus exact completion wall time before a running segment is frozen.
- `src/lib/pomodoroSession.test.ts`: 24 preset, count, exact phase, one/multiple set, delayed tick, baseline and snapshot cases.
- `src/lib/pomodoroSessionTracking.test.ts`: 7 transition/Actual integration, completion wall-time and fresh-session cases.
- `src/lib/actualTracking.ts`: idempotent create/start/pause/resume helpers; existing elapsed calculation/formatting unchanged.
- `src/lib/actualTracking.test.ts`: 3 new repeated transition/reset cases; 6 existing cases preserved.

Verification on this domain snapshot:

1. New domain/transition tests failed before implementation (missing model/helpers); additional completion tests failed before explicit-completion implementation (11 assertions); 3 completion-wall-time cases failed before the helper existed. Logs: `/tmp/pomodoro-model-red.log`, `/tmp/pomodoro-completion-red.log`.
2. `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/pomodoroSession.test.ts src/lib/pomodoroSessionTracking.test.ts src/lib/actualTracking.test.ts --maxWorkers=1 --minWorkers=1`: exit 0, 3 discovered files / 40 tests passed. Actual boundary coverage is in the new integration test. Log: `/tmp/pomodoro-domain-focused.log`.
3. Focused TypeScript with the project's strict/unused/module flags against the five domain files: exit 0. Log: `/tmp/pomodoro-domain-types.log`. This is not the full app/Worker typecheck.
4. Exact domain diff inspected; `git diff --check`: exit 0.

Runtime/dependency identity: Node v24.19.0, installed Vitest 3.2.7, TypeScript 5.9.3, React 18.3.1; node_modules points to the existing `studyplanner-gpt6-luna-20261012/node_modules`. The command-local DEV_LAN_HOST override uses the repository's supported network configuration path because sandbox network-interface enumeration throws at Vite startup; no source/config/test weakening occurred.

Domain file SHA-256 at verification:

- pomodoroSession.ts: `e3242d76692f5ef0e9e299b7af86025e9ad68c23e2d41286ca847b467efa7efe`
- pomodoroSession.test.ts: `023dd0bb567fbef01c8f27edf6da8eccdd19e541fa7ed6103abc2468d685c199`
- pomodoroSessionTracking.test.ts: `0d6cb15162a9e084c2fc430e99a05fc894c3349923d1f55db314a0b5e6d6d7ae`
- actualTracking.ts: `dd0fea575ebc3d197642e20c2282355e1f2197a5e8133d11e19699d70e9d68e9`
- actualTracking.test.ts: `ddb20bc954ddc700f16d33760ffb3831fe68592089a250081036a262fb97120d`

## Remaining integration work and definition of done

- UI/domain integration is implemented: separate settings, fixed active snapshot, completion freeze, disabled restart, canceled and stale callback protection, normal/manual paths. Remaining user-facing verification is real desktop/mobile browser behavior and reload/focus/gesture presentation.
- Completion wall-time preservation is implemented and tested: a completed session left open overnight does not create a false date-adjustment requirement; genuine midnight crossing still requires review.
- Independent exact-diff review and the final full local gate passed as recorded below. Real browser/visual/remote gates need authorized publication and remain separate. The new CSS raw-size gate failures need an explicit release/budget decision; they are not inherited or hidden.
- Exit criteria: presets/count work; canceled edits and started sessions remain stable; phase boundaries and repeated pause/resume count only active elapsed; finite completion includes the last break and never overcounts; normal/default behavior and Actual ownership remain unchanged; desktop/mobile interactions and final exact-content gates pass.

## Independent integration ownership (2026-10-13)

The prior implementation owners handed off the existing worktree at base/HEAD `e44f4b4154608a4ebd41399b8f41d6f6dce7431c`. The integration reviewer now owns this combined source through local commit, with no remote writes. Issue #190 was re-read (open, no comments); searches found no other Pomodoro issue/branch/PR. The next step is to reproduce any stale-selection defect, correct the bounded integration, then freeze inputs and run one full `npm run verify`, bundle report and browser spec collection. Real browser execution remains blocked by the already confirmed environment capability limits; no identical launch route will be retried.

## Independent audit and first frozen integration receipt

- Reproduced a retained Start callback using the pre-settings 25/5 unlimited configuration after 50/10 and one set had been saved. Corrected the boundary to use the latest accepted setup when fixing the active snapshot. Also reject discarded settings callbacks after reopening another settings screen; batched draft choices preserve earlier edits.
- Added three lifecycle regressions; combined domain/component focused suite: 86/86 passed. Initial regression failed with 25:00 instead of 50:00 before the fix.
- First frozen integration on e44: `npm run verify` exit 0; fresh app/Worker types, 831 files passed / 10 skipped; 7,686 tests passed / 45 skipped / 1 todo; production build 5.07s. All 2,403 source inputs and 19,305 installed files matched before/after. Durable local evidence directory: `pomodoro-settings-integration-evidence-20261013` beside the worktree; `identity-before.json`, `identity-after.json`, `verify.log`, `verify.exit`, `stale-start-red.log` and `integration-focused.log`.
- Exact build: JS raw/gzip 2,348,239/632,895 bytes, largest 832,753/236,128; CSS raw/gzip 493,363/83,695 bytes, largest 425,678/69,193. Same e44 baseline CSS was 492,679/83,578 total and 424,994/69,076 largest. New CSS growth is 684/117 bytes and causes new raw-total +363 and raw-largest +678 budget violations. JS growth is 6,091/1,902 bytes and adds to the baseline's existing aggregate violations. Thresholds, dependencies and loading boundaries were not changed.
- Browser test collection discovered 36 cases (6 new settings/mode, 30 existing compact-start). This is collection only, not browser execution. Earlier Chromium sandbox EPERM persists as a capability blocker; its exact prior log is preserved in the evidence directory, and the failed route was not repeated.
- The initial new browser spec's prohibition on vertical scrolling in the separate settings screen was an unrequested overconstraint. Corrected it to allow vertical scrolling while requiring the Save control to be reachable and preventing horizontal overflow. The actual Start-screen one-screen assertions, selected values, focus restoration, gesture/keyboard/reduced-motion assertions and enlarged-text coverage remain.
- Current main advanced to `05c78b6f` with PR #602's four AI approval files only. The existing feature worktree was fast-forwarded normally, keeping all feature edits and all upstream files. No AI code was edited. Because integration inputs changed, a distinct final main-05 verification is required; e44's successful receipt is not relabeled as that result.

## Final latest-base local verification

- Command: `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm run verify` with the evidence-directory Wrangler log path. Exit 0. Fresh non-incremental app and Worker types passed; the Worker runtime declarations were regenerated; 832 test files passed / 11 skipped, 7,700 tests passed / 54 skipped / 1 todo; production build passed in 5.67s. No lint script is configured.
- Skip classification: the increase from 45 to 54 is exactly the nine cases in upstream PR #602’s `tests/firestore/weeklyPlanningApprovalFirstSave.emulator.test.ts`. Its existing `describe.skipIf(!enabled)` requires both `FIREBASE_AUTH_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST`, which are absent for the ordinary unit run. Its blob matches main exactly. These are unexecuted emulator cases, not failures or passes; no skip condition, global runner filter or infrastructure was changed.
- Base `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`. `identity-before-main05.json` and `identity-after-main05.json` establish that all 2,405 source inputs and 19,305 installed files were unchanged during verification. `main05-reconciliation.json` proves that the upstream four approval files match their exact base blobs and no feature runtime/unit-test source changed during base reconciliation. Runtime/tool identity remains Node 24.19.0, React 18.3.1, Vitest 3.2.7, TypeScript 5.9.3; CI's separately configured Node 22 and remote/browser execution are not claimed.
- Final bundle gate: exit 1, honestly retained. JS total raw/gzip 2,348,972/633,033 bytes and largest 833,486/236,260; CSS total 493,363/83,695 and largest 425,678/69,193. CSS raw total exceeds 493,000 by 363 bytes and largest exceeds 425,000 by 678 bytes; both CSS gzip metrics pass. New feature CSS growth remains 684 raw / 117 gzip bytes. Aggregate JS also remains over its existing limits. No threshold, class-name compression, unrelated deletion or CSS loading change was used to conceal growth.
- Browser collection after correcting the unrequested settings-height restriction: exit 0, 36 cases in two files. No actual browser result is claimed. Saved evidence includes the prior environment launch failure. Remote CI/browser acceptance requires publication approval, and passing the new size gates requires a separately reviewed bounded budget decision or an ordinary design-preserving consolidation.
- Receipts and logs are durable in `pomodoro-settings-integration-evidence-20261013` beside the worktree. Prior `/tmp` domain/browser logs were copied there; they are historical evidence only. Final receipts: `verify-main05.log`, `verify-main05.exit`, `identity-*-main05.json`, `bundle-main05.json`, `browser-collection-final.log`, and `commit-receipt.json`.
- Only this handoff and its domain-index link were updated after verification; all runtime, test, build/config and dependency inputs still match the successful final snapshot. This documentation-only receipt update does not relabel any unrun gate as passed.
- No new Issue, remote branch or PR was created, and no branches were deleted. Reused Issue #190 and `feat/pomodoro-session-settings`. Personal default persistence, AI scheduling integration and the remaining broader Issue #190 scope were not added.


## Published CI follow-through and browser coverage (2026-10-13)

- Publication owner created [PR #610](https://github.com/kame447/StudyPlanner/pull/610), public head `01a783123274d78568166289989e87db0c342932`, with the exact locally verified tree `0b59925f70d278ff57ede2f993dccdfd5a27023f`. It is Draft; main merge/deployment remains outside authorization. The initial unpublished-local state above is historical.
- CI runs checkout PR merge `1b0d24a1f5a214ad8d47ec34e849babe4010545c` against base `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`. [CI run 38362518931](https://github.com/kame447/StudyPlanner/actions/runs/38362518931) passed fresh app/Worker types, 7,700 unit/integration tests (54 skipped / 1 todo), Firestore profile/ScheduleEvent authority Rules regression, production build and diff check on Node 22.23.0.
- Remote bundle artifact reports the exact same byte counts as the final local receipt, with both genuine new CSS violations and existing aggregate JS violations unchanged. Browser quality, Admin render and the existing visual matrix passed. Initial full Browser Regression and WebKit mobile were still running when browser coverage was reviewed; they are not relabeled as passed.
- Browser coverage gap: initial six new cases checked presets/count selection, inputs/Back/focus, Start locking, slide/swipe/keyboard/reduced motion and enlarged text; finite completion and midnight had only unit/component evidence. Add three browser cases to the same spec: 25/5 one set and 50/10 two sets through their final breaks, pause exclusion, delayed ticks, no automatic navigation/save, explicit Finish/Save, overnight completed sessions, fresh-session defaults, and a true midnight-crossing save block.
- These are verification additions to the same feature and PR, with no production, dependency, runner, timeout, budget or external-service changes. New browser execution requires the publication owner to publish the reviewed update; local browser-launch failures are not retried. Evidence is in `pomodoro-settings-ci-evidence-20261013` beside the worktree.

- Browser-coverage update local verification: `npm run verify` exit 0, fresh app/Worker types, 7,700 passed / 54 skipped / 1 todo, build 5.09s. Before/after source and installed dependency manifests matched. The updated pair of browser specs collects 39 cases; the three new finite-completion/midnight cases have not yet run in a browser. Production bytes are unchanged, so the earlier exact bundle report remains applicable.

## Initial browser findings and bounded correction

- Initial Browser Regression run 38362518682 finished with 582 passed and one failed source-policy scan. All six Pomodoro browser cases passed. The failure lists exactly three new non-input focus statements: keyboard movement between mode buttons, opening the settings heading, and returning to the settings-launch button. Add only those exact statements to the existing audited allowlist, with reasons; no file-wide exception or input-focus relaxation. The actual focus targets are already asserted by the feature browser tests. The corrected source-only policy test passes locally without launching a browser.
- All five UI Regression Matrix jobs passed, including WebKit mobile (207 passed / 3 skipped). Real downloaded dark-mobile screenshots nevertheless exposed an indistinguishable sliding selection face: the track used a gradient-valued app-background token inside color-mix, so its background was invalid. Replace only that argument with the existing accent color token; leave indicator geometry, horizontal animation, reduced motion and touch targets intact.
- Extend the four light/dark and standard/pixel feature cases to inspect both selected positions. Capture each rendered screen and computed color metrics, reject a transparent track/face, require visible face-to-track separation, and check both labels at 4.5:1 contrast over the possible translucent backdrops. The face-separation regression bound is not claimed as a WCAG threshold. These new assertions and the three finite-completion cases still require remote browser execution after this local correction is published.
- Initial Chromium image archive SHA-256: 5cba7a4e93b6cc4f9b9d93096bac42eb51672e8a49991d5d09caec5b9ebc7e1b; WebKit mobile image archive: 5036c481f2aa563b0c1037bf79f6dc4d11945bc69d072a110a5d8eeb0bace255. Both downloads were hash-verified and retained beside the worktree. Initial CI is not a pass for the corrected source.
- The rendered new dark/pixel settings screen additionally showed the selected preset's inherited white text on a light aqua accent (approximately 2.4:1). Scoped the selected text color to the theme surface token only within Pomodoro settings, making it dark on the dark theme's light accent and light on the light theme's dark accent. The browser cases now measure both preset labels too. No other segmented control was changed. The earlier indicator-only verify finished green before this discovery was applied; it is historical, not proof for this distinct final source.

## Final correction verification receipt

- Frozen final correction: fresh app/Worker types passed. The first aggregate attempt had one failure in the unchanged Jev mock token-rotation test (received incomplete_HOLD); 7,699 other cases passed. The same test file passed 103/103 in isolation, then one unchanged aggregate retry passed: 832 files / 7,700 tests passed, 54 skipped / 1 todo, build 4.98s. No test timeout, filter, quarantine, dependency or Jev source changed. The failed scenario's cleanup removed its detailed HOLD result; its root cause is undetermined, and a slower test-file duration alone does not establish resource causality. Both the failure and successful retry are retained, not replaced.
- All 2,405 source inputs, 19,305 installed files and recorded environment variables matched before/after the successful retry. Exact proof: `verify-final-retry.log`, `verify-final-retry.exit`, `identity-before-final-retry.json`, `identity-after-final-retry.json`, and `token-rotation-diagnostic-receipt.json` in the durable evidence directories beside this worktree. The browser specs collect 39 cases; source-only input-focus policy passes. New finite-completion and computed-contrast assertions remain unexecuted until updated remote CI.
- Final production bundle gate remains exit 1. CSS total raw/gzip 493,450/83,702 bytes; largest 425,765/69,200. Raw total is over by 450 and largest by 765. The actual visual fixes add 87 raw / 7 gzip bytes to the initial feature bundle, bringing feature CSS growth from e44 to 771 raw / 124 gzip bytes. JS total raw/gzip 2,348,972/633,034; largest 833,486/236,260. Thresholds and loading boundaries are unchanged. This is not ready-to-merge evidence while these budget violations and updated remote checks remain open.
- Main/base was rechecked as `05c78b6fa0d708c39e7ca5ceb1703ca80f7509a9`; public PR head was still `01a783123274d78568166289989e87db0c342932`. Only this receipt changed after final verification. Publication is delegated to the existing PR owner; no remote write or main change was made by this integration task.

## 2026-10-14 custom durations and concise session UI

- Follow-on scope for Issue #190: add per-session custom focus/break durations alongside unchanged 25/5 and 50/10 presets; remove the timer's set/next-phase helper and explanatory paragraphs, and consolidate explanations in FAQ. No account-default or AI scheduling change.
- Base: `70953efd`; implementation branch: `work/custom-pomodoro-20261014`. The prior `origin/feat/pomodoro-session-settings` commit is an ancestor of this base; this is the user's new follow-on request, not a duplicate of that completed feature.
- Existing resolved-duration, phase, explicit set cap and break-inclusive Actual contract are reused. Custom durations must be whole minutes from 1 to 1440; empty/zero/negative/fractional/nonfinite/out-of-range values cannot be saved or resolved. Switching presets retains valid custom draft values. The background-session owner handles snapshot persistence separately using the same optional custom duration fields.
- Focused verification: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/pomodoroSession.test.ts src/lib/pomodoroSessionTracking.test.ts src/components/PomodoroSettingsView.test.tsx src/components/StudySessionView.unplanned.test.tsx`: exit 0, 4 files / 88 tests passed. Covers both presets, custom phase/set boundaries, invalid inputs, mode switching, removed helper text, FAQ explanation, and custom session through explicit record save.
- Environment: existing installed dependency tree reused from the background-timer worktree; Vite's dev URL helper requires the supported `DEV_LAN_HOST` override because this execution host cannot enumerate network interfaces. No runtime or test config changes were needed.
- Full suite/build/browser verification is intentionally owned by the integration owner, not duplicated by this implementation worker. Mobile layout uses three equal columns, falling back to a single column at 360px; rendered browser verification remains pending integration.

- Final worker type feedback: `npm run typecheck:app` exit 0 after the final test/source changes; `git diff --check` passed. No GitHub write or push performed by this worker. Integration owner must run the combined full verification and UI acceptance before publication.
