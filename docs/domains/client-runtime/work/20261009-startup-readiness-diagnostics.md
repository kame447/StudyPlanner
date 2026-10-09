# Separate startup readiness from intro presentation

Status: verified local candidate snapshot; publication, exact-head CI and deployment status are tracked by the owning pull request.
Owner: Issue #542. Existing startup/recovery work in #479, #548 and #550 is retained.
Publication branch: `fix/startup-diagnostics-publication`; original local branch retained as `fix/startup-readiness-diagnostics`.
Original implementation base: local `7177cb2417a43ac5cd58f70f36011303128148a1`, tree `e87ca1829f6f89559a36c56ea8deaa167679505d`, verified release-equivalent to main `1207f1a` by the owning release task. Relevant startup source blobs independently matched the exact remote ref before implementation.

## Scope and alternatives

The existing `home-visible` includes both application preparation and intro completion. It does not identify their separate completion times. This is a diagnostic gap, not proof of the reported Home Screen delay's cause.

- Reuse bootstrap completion alone: insufficient because memory initializes in parallel and a failed bootstrap can still release recovery UI.
- Mark any presentation `loading=false`: low code cost but consent errors, onboarding and sign-out also release presentation. This would falsely imply successful application readiness.
- Reconstruct successful authenticated readiness from planner/memory/owner predicates: rejected after review because it duplicates the existing gate and can drift.
- Observe the existing presentation signal under the deliberately non-success label `startup-wait-ended`: selected. It includes sign-in, onboarding and recovery exits, retains existing error rows, checks the supplied current-session guard, and records each distinct wait exit without defining readiness again.

Record a separate `intro-complete` point with a fixed `introOutcome` reason in the existing local-only recorder. Keep `home-visible`, ordinary playback/skip, consent, authentication, errors, the 80-row cap and stop-at-Home contract unchanged. No identifiers, data contents, URLs, raw errors, persistence or telemetry.

## Original local-snapshot verification (0f9e5e82)

- Initial focused run: 49 passed in 4 files.
- Expanded final focused run: 146 passed in 9 files, including the real root/consent/preferences/memory/bootstrap fixture, parallel-startup owner cases, video behavior, recorder and Home observer tests.
- The first expanded run found one test-harness mismatch: the existing test returned the same completion spy for every phase. It now uses separate consent/preference/other completion spies and requires each error exactly once. No production failure was hidden or error assertion weakened. The final run includes this correction.
- Fresh app typecheck and production build passed for the runtime diff. A second fresh app typecheck passed after the test-only stub correction, covering the final source.
- All existing bundle guards passed without changed limits: JS 2,256,668 raw / 607,378 gzip bytes; largest chunk 775,746 raw / 219,101 gzip bytes. Existing optional appearance budgets passed too.
- Independent static review found no blocking issue. The parent separately reviewed the phase-specific test correction.
- A localhost-only Chromium probe loaded the real StartupSurface/StartupVideo/StartupTimingPanel and synthetic existing identity/data fixture. Four cases passed: wait-before-intro at 390 and 1280 pixels; intro-before-wait at 390 pixels; and same-batch session replacement plus intro completion at 390 pixels. The real Home observer followed both points in successful cases. The replaced-session case retained only the shared intro completion and produced neither a wait-ended nor Home point.
- Browser media progression was held and the ended event was explicitly released. These observations establish event ordering, not natural playback duration, real Firebase/network performance or installed-PWA latency. Full playback behavior remains covered by existing video/root tests.
- The browser probe's first two executions could not reach a server launched in a separate tool execution. Running the server and browser in one execution with an HTTP readiness check resolved this harness isolation issue. The app was not changed for it. The temporary server was stopped.
- Diagnostic panel screenshot at 390 pixels was inspected: text wraps, existing bounded scroll and bottom navigation clearance are retained.

Full-suite CI, Worker/Rules verification and real iPhone/PWA measurements were not run for that original local-only snapshot. Publication requires the normal exact-head broader release gates. Installed-PWA cause and speed improvement remain unproven. See `docs/work/startup-timing.md` for the updated interpretation contract.

## PR #558 integration checkpoint — 2026-10-09 UTC

The existing publication branch and PR #558 are retained. Public head `7227837b05a58a18c483d0201bc1db18f8f89e53` passed 499 browser cases but failed both cold-start width cases because their old five-field privacy assertion rejected the new `introOutcome` field. The failure repeated on retry; this was a stale test contract, not a reason to permit arbitrary diagnostic data.

Local commit `c7f64c23` replaces that assertion with an independent strict schema check: only `intro-complete` requires the sixth field and one of the six fixed reasons; every other phase retains exactly five fields. Existing numeric timing checks, private fixture-content rejection and read/preload assertions remain. Eighty focused schema cases cover accepted reasons, every other phase, extra/private properties, missing fields and invalid timing values. Together with eleven recorder cases, 91 passed before integration.

External main `657805e089969588f474d8220c24db9a3c8fe5c3` was then normally merged as local `e0943e83`. Its Laplance name, replacement video/poster/still and current five-second native-video contract are preserved. The sole merge conflict combined the new `Laplance` image assertion with the existing diagnostic-clock assertions. The diagnostic unit fixture's synthetic terminal timestamp now uses 5,000 ms. Runtime playback behavior was not changed for the test correction.

The integrated startup/branding/schema focused run passed 236 cases in 11 files. Fresh app types, production build and all existing bundle guards passed. Four targeted Chromium cases passed with retries disabled: cold/warm startup at 1280 and 390 pixels, real five-second media completion while data remains pending, and real five-second completion after the app becomes ready. The latter two use the latest main native-video contract, not synthetic ended events. All 1,433 runtime/test/build input hashes remained unchanged through verification.

The initial local browser attempts stopped before page setup: preview tried to enumerate unavailable network interfaces, then the runner's default cache location lacked ffmpeg. Explicit loopback hosting and the existing isolated browser cache resolved those environment prerequisites. No test assertion, timeout, retry count or runtime behavior was changed for them. These setup failures are separate from the final four-case successful run.

The old candidate dist was preserved; the integrated source was freshly built for this verification with Firebase configuration unset for synthetic local-repository tests. Old-tree evidence above is not substituted for the integration result. Full exact-public-head CI, deployment and merge status remain with PR #558 and must be checked after publication. Real installed-PWA performance remains unverified. No new Issue or PR, force push, main write, branch deletion or manual deployment was performed by this local integration.
