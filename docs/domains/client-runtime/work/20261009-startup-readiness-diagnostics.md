# Separate startup readiness from intro presentation

Status: verified local candidate snapshot; publication, exact-head CI and deployment status are tracked by the owning pull request.
Owner: Issue #542. Existing startup/recovery work in #479, #548 and #550 is retained.
Publication branch: `fix/startup-diagnostics-publication`; original local branch retained as `fix/startup-readiness-diagnostics`.
Base: local `7177cb2417a43ac5cd58f70f36011303128148a1`, tree `e87ca1829f6f89559a36c56ea8deaa167679505d`, verified release-equivalent to main `1207f1a` by the owning release task. Relevant startup source blobs independently matched the exact remote ref before implementation.

## Scope and alternatives

The existing `home-visible` includes both application preparation and intro completion. It does not identify their separate completion times. This is a diagnostic gap, not proof of the reported Home Screen delay's cause.

- Reuse bootstrap completion alone: insufficient because memory initializes in parallel and a failed bootstrap can still release recovery UI.
- Mark any presentation `loading=false`: low code cost but consent errors, onboarding and sign-out also release presentation. This would falsely imply successful application readiness.
- Reconstruct successful authenticated readiness from planner/memory/owner predicates: rejected after review because it duplicates the existing gate and can drift.
- Observe the existing presentation signal under the deliberately non-success label `startup-wait-ended`: selected. It includes sign-in, onboarding and recovery exits, retains existing error rows, checks the supplied current-session guard, and records each distinct wait exit without defining readiness again.

Record a separate `intro-complete` point with a fixed `introOutcome` reason in the existing local-only recorder. Keep `home-visible`, ordinary playback/skip, consent, authentication, errors, the 80-row cap and stop-at-Home contract unchanged. No identifiers, data contents, URLs, raw errors, persistence or telemetry.

## Verification and remaining boundary

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

Full-suite CI, Worker/Rules verification and real iPhone/PWA measurements were not run for this local-only candidate. Publication requires the normal exact-head broader release gates. Installed-PWA cause and speed improvement remain unproven. See `docs/work/startup-timing.md` for the updated interpretation contract.

No new Issue or PR. No remote branch, main edit or deployment. No branch deletion.
