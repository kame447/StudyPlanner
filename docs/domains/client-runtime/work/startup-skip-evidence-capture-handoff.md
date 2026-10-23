# Startup skip evidence capture

Status: current-main local verification passed. Exact-head native integration
gates remain pending; historical startup acceptance is not a replacement.
Branch: `test/startup-skip-capture-order`, PR #809. Original base was
`22e42203a4df82b5432d4290b7b5ea3a4246b8c9`; the current local integration base is
`ae833f7ac4d7af1d09a66da586f96276cdf085f4`.
Scope: diagnose the ready touch-skip failure observed on PR #801 without changing
startup product behavior or the separate complete-playback acceptance tests.

## Evidence and uncertainty

[UI Regression Matrix run 39395904583](https://github.com/kame447/StudyPlanner/actions/runs/39395904583),
job `118538450970`, failed the 1280px ready touch-skip case on both attempts.
The native tap found an enabled visible button, then the element detached during
actionability/scrolling. Both final snapshots show Home. The same case passed on
main `22e4220` and an earlier #801 run; this is not an established baseline failure.
The owner verified application and E2E source are identical between current main
and the failing #801 head; dependency/tooling differences remain.

The traces show the assertion that the original video had not ended succeeded.
The next screenshot took 1.347 seconds on the first attempt and 1.070 seconds on
retry, before the tap was attempted. Tap began approximately 5.206 and 4.996
seconds after navigation finished, respectively, for the five-second clip.
Natural completion racing the tap is strongly supported, but an explicit native
`ended` event was not recorded for this case. Media-error/stall teardown is an
alternative, not disproved solely by the final Home snapshot. An application
remount is another possibility, but original-video identity and connection were
asserted immediately before the screenshot. The fix does not pretend those
alternatives were definitively excluded.

## Minimal correction

Move the optional screenshot attachment after the real tap and all Home,
splash-removal and media-unload assertions. Rename it `laplans-after-skip-*` so
it describes the actual captured state. The attachment is not a golden-image
assertion and no checked-in consumer requires the old attachment name. Existing
trace snapshots and screencast retain pre-action diagnostic evidence on traced
runs; the failed first trace contains 44 frame snapshots and 63 screencast frames.

Preserve real media transfer/playback, metadata, readiness and original-node
identity checks; preserve the `!ended` assertion directly before the native tap.
No forced tap, swallowed timeout, accepted-ended fallback, pause, clock change,
product-code change or relaxed assertion. Separate complete-playback cases are
unchanged. The correction removes a demonstrated avoidable delay, not every
possible race against real playback.

## Verification and next step

- JavaScript syntax check passed.
- WebKit-mobile collection passed: 22 cases in this spec.
- Exact diff whitespace check and independent assertion-preservation review passed.
- Full `npm run verify` passed on 2026-10-20: fresh application and Worker
  runtime types, 1,054 test files / 10,528 tests passed, 67 skipped and one todo;
  production build passed in 14.23 seconds. Existing documented telemetry, error
  report, update-banner and Miniflare CF-fetch opt-outs were enabled; no
  network/security escalation was used.
- This original local check did not execute native browsers. Local browser-startup
  restrictions are not a passing result; the published native evidence is below.
- No source-string regression is added: it would lock the implementation text
  without exercising playback. The existing actual-browser case is the relevant
  acceptance test, with an exact independent review of unchanged assertions.

## Published native evidence and current-main continuation

Published head `c35ec13dec8632416e25fb796fdb4e5ae70cacd1` passed
[Browser Regression 39461225910](https://github.com/kame447/StudyPlanner/actions/runs/39461225910)
and [UI Regression Matrix 39461225553](https://github.com/kame447/StudyPlanner/actions/runs/39461225553).
WebKit-mobile job `118760894583` passed all 22 startup-video cases on their first
attempts, including both native touch-skip widths and the complete-playback
cases. Its UI Quality failure was the six bundle categories from before main's
budget calibration; that historical failure is not a current integration result.
The successful native run addresses this candidate's acceptance; it does not
prove the original trace's unrecorded native ended event.

The authorized cleanup continuation normally merges main
`82a948ae6dd9f39d6a445d3408b8b8d3ae2664a3` into the same branch. Parent-prepared
local merge `ab9b7dbd093afde63cb5dac241544a7ac21c4a4a` preserves the startup
native spec byte-for-byte. Fresh focused/type/native integration evidence is
still required; prior green checks are bound to the published original head.
Keep this separate from #801's dependency correction. The coordinator owns
publication and the final integration gates; no main merge is claimed here.


## 2026-10-23 current-main local integration checkpoint

- Reused PR #809 and its existing branch; no new Issue, branch or PR. The
  coordinator owns publication and final integration. No remote write, main
  merge, branch deletion or browser CI launch occurred in this preparation.
- Fresh remote head: `7121431ce4bb51260129053d7248ae6f6bca91b7`.
  Current main: `df675184f72b2717f68cd71eb89bb6b2a83a2394`.
  Conflict-free local merge: `dd990eae744848a0ef15fbeba4ea51e17acc0f91`;
  verified tree: `0a902fe10df6c28a08d5cde58227c0d78ffa1f19`.
- The startup spec is byte-identical to the remote PR head. Independent review
  confirmed that only the screenshot position/name/comment differ from main;
  all native touch, keyboard, playback, readiness, original-node, `!ended`,
  unload and full-completion assertions remain unchanged.
- `npm run verify` exited 0: fresh application and Worker typechecks, 1,067
  passing test files / 11,197 passing tests, 12 skipped files / 67 skipped tests
  and one todo; production build passed in 13.76 seconds. The command environment
  set `DEV_LAN_HOST=127.0.0.1`, `WRANGLER_SEND_METRICS=false`, and a temporary
  `WRANGLER_LOG_PATH`. Node was 22.23.4 and npm was 10.9.9. No lint script exists.
- All 242 installed package versions matched the lockfile. Lockfile SHA-256:
  `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`.
  Installed content SHA-256 before and after verification was unchanged:
  `f651d45b4369315f5719fe678deca3860509f7bb89bdfb251263d297dad198c6`.
  This covers 19,392 files, hashing sorted relative path, NUL, file SHA-256 and
  newline, excluding generated `.cache`, `.vite` and `.vite-temp` directories.
- Verify log SHA-256:
  `70b05b4b2396b05d7ff5c88fe08af1e751b427a3fbc7cf6a93369c13ee84b43a`.
  Tracked verification inputs remained clean throughout the run; the only
  untracked output was `.cache/`. This checkpoint update is documentation-only.
  `node --check tests/e2e/laplance-startup-video.spec.mjs` and `git diff --check`
  passed separately.
- The historical UI Regression Matrix run 39849315723 on `7121431c` was
  cancelled, not a passing integration gate. Native browsers were not run for
  this new integration snapshot. Next: coordinator reconciles any later main
  change, publishes only when authorized, and follows all applicable exact-head
  CI/native-browser gates to terminal results. Do not call the PR merge-ready
  based only on the local aggregate or historical original-head browser pass.

## Final integration after the scoped Month allowance

- Existing PR head `7891dfa7548138dc399a92232473deef71e03c54` is integrated with actual main `ae833f7ac4d7af1d09a66da586f96276cdf085f4` after #844 and #845. The startup spec remains byte-identical to the existing PR head; no startup behavior or assertion changes are added.
- Previous exact-head native evidence passed all 22 startup cases on their first attempts. The prior Matrix failure was the separate Month 1280 case (first-attempt 30-second timeout, retry success), not startup acceptance. The approved Month allowance is supplied by merged #845, not a new timeout change in #809.
- Earlier local and native records above are historical snapshots. This integrated content requires its own final local verification and applicable native gates; publication/merge are authorized only with those gates satisfied.

- Final integrated local `npm run verify` exited 0 on Node 22.23.4 / npm 10.9.9: fresh application and Worker typechecks, 1,069 passing test files / 11,201 passing tests, 12 skipped files / 67 skipped tests and one todo; production build passed in 14.88 seconds. The unchanged bundle-budget checker passed.
- The tracked patch was identical before and after verification (SHA-256 `55fa1602e09a007a69d4d6270cfa1b6c975857455d707a15a6aad0ca0beb44e8`). All 19,392 installed dependency files matched the previously verified shared installation; no content mismatches were found. The package manifest and lockfile also matched. Only this documentation receipt was changed after verification.
- Final verification log SHA-256: `d1282c099c192db427e8a69dce221efedadc7224c71b4f3bcf0bb116f89aaa06`. Native exact-head CI remains required before merge; no new native result or product performance improvement is claimed.
