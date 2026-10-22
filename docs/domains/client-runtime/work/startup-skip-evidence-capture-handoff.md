# Startup skip evidence capture

Status: native verification passed on the published original head; current-main
integration verification in progress.
Branch: `test/startup-skip-capture-order`, based on main `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
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
