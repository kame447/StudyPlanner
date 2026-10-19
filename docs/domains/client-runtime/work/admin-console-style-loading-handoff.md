# Defer administrator-only console styles

Status: approved for publication; combined verification and native acceptance in progress.

## Native probe baseline correction

The first published production probe failed the dark/standard round-trip color comparison in Chromium desktop. Both attempts reached the same correct final color, but recorded different initial intermediate colors. The ordinary body stylesheet transitions inherited color for 0.2 seconds after the root theme attribute changes; reduced-motion emulation does not override that fixed duration. Trace timing placed baseline sampling immediately after the root-theme assertion. The probe now waits for the legal card to reach the non-transitioning root's final computed color before capturing its baseline. The original exact nine-property before/after comparison, lazy-CSS gate, all five width checks, theme/appearance combinations, and document/cache assertions remain unchanged. No runtime CSS or expectation is relaxed; native execution of the corrected probe remains required.
Owner: Issue #542.
Branch: `perf/defer-admin-console-styles`.
Base: main `56a8e52212b72074e99f092d91b1bef488bc365f`, tree `9a4bf105d3c76b5290e24a2283669c14e0fbaca5`.

## Approved integration checkpoint — 2026-10-16

The owner has approved publication and main integration after browser verification. The following local implementation records retain their original test scope and historical limitations. Current release status is tracked in [Issue #542](https://github.com/kame447/StudyPlanner/issues/542#issuecomment-6209395456) and the four responsibility-specific PRs, rather than inferred from these earlier local measurements.

The original release composition was based on `56a8e52212b72074e99f092d91b1bef488bc365f`. After renewed approval, the integration preserves current main `da462379b2ef57d5028762da36a11e8976b5d9b6`, including #711, and the independently verified Actual first-save repair in [PR #712](https://github.com/kame447/StudyPlanner/pull/712) (tree `b6d03539705f8785d16ba4c9629b130222fb1610`). Publication of this loading release resumes only after that repair is adopted and delivery-verified. Month lazy loading and its bounded preload registration are accepted together; material detail reuse and corrected administrator CSS are additional independent review units in the cumulative release. Final combined full verification and native browser acceptance must complete before main integration. Existing capacity-budget failures remain separately deferred without changing thresholds. Physical-device speed is still unmeasured.

## Scope and decision

The normal entry imports administrator-only console/overview CSS even though
`AdminApp` already has a lazy route and a separate stylesheet. Move only that
console/overview styling to the existing lazy boundary. Keep rules for elements
that also use shared `app-shell` or `panel` classes at their original global
cascade position. Keep `admin.css` initial because its elements also use shared
panels and buttons. Preserve every declaration, selector and media condition;
no theme, font, image, video, readiness, access or navigation behavior changes.

Alternatives inspected: the optional dot font already has selection-only CSS
and `font-display: swap`; preloading it would increase ordinary startup work.
The current intro is a 839,108-byte five-second MP4 with small poster/still
assets and metadata before media data. No measured device decode bottleneck
justifies changing its quality, playback or fast-start arrangement. Moving all
administrator CSS would reverse equal-specificity cascade against later shared
responsive rules, so that broader move is rejected.

Before implementation, current #542 and its comments, open font/loading/admin
CSS PRs and perf/css branch names were checked. No active candidate owns this
bounded style-loading change. Existing read/deferred-contact work is separate.
No new Issue or PR is created; no remote branch or main mutation is authorized.

## Independent review correction

The initial local commit `590e6744` retained shared shell rules but missed the
three overview panel classes. Independent review showed that moving their CSS
after responsive `.panel` rules changed equal-specificity padding: at 320px,
metrics 10→12 and cards/alerts 10→14; at 390px, cards/alerts 12→14; at 600px,
all three 12→14. That candidate was never published and is superseded locally.
Byte-identical moved CSS alone did not establish equal rendered behavior.

The correction keeps all five rules for `.admin-overview-metric` (default,
max-820 and max-520), `.admin-overview-card`, and `.admin-overview-alerts` in
`admin-shell.css` before the shared responsive stylesheet. Keeping each full
rule, rather than just padding, retains every applicable declaration's original
cascade relationship. It preserves values, selector specificity and media
conditions without compensating overrides, `!important` or layout redesign.

## Current local verification (2026-10-16 UTC)

- Production HTML/manifest static closure still contains one initial stylesheet
  and five initial JavaScript chunks. Administrator console CSS belongs only to
  `AdminApp`'s existing dynamic route resource; no new request is introduced.
- Initial CSS: 449,310 → 434,887 raw bytes (−14,423, 3.21%); level-9 gzip:
  73,292 → 71,164 bytes (−2,128). Admin CSS: 13,165 → 27,662 raw bytes.
  Initial JavaScript raw bytes are unchanged. Additional retained media wrappers
  add 74 bytes to total CSS raw and 178 bytes to aggregate level-9 CSS gzip.
- All 149 original console rules retain their selectors, media conditions and
  declarations. The five shared-panel rules and two shared-shell rules stay
  before responsive CSS; their internal ordering is retained. Every emitted
  non-code asset (video, images, icons, dot font and notices) remains unchanged.
- The new equal-specificity source-cascade guard reproduces three failing width
  cases on `590e6744`. The correction passes all three panel classes at widths
  320/390/600/900/1280, including the unchanged desktop 14px padding. This is a
  source-order regression test, not actual browser computed-style evidence.
- Final focused suites: 129 tests / 12 files passed, covering style ownership,
  responsive panel cascade, route/auth access, administrator request lifetime,
  root readiness, video outcomes and dot paint invariants. The original two
  import ownership guards also failed against unchanged main and pass here.
- Fresh non-incremental application typecheck and production build passed.
  Environment: Node 24.19.0, Vite 6.4.3, Vitest 3.2.7, TypeScript 5.9.3,
  React 18.3.1, PostCSS 8.5.26. Builds use the existing dependency tree;
  no package/lock/config changes. `DEV_LAN_HOST=127.0.0.1` uses the supported
  config override because interface enumeration is unavailable in the sandbox.
- All eight existing bundle-budget violations remain, with unchanged limits.
  Neither the budget gate nor full combined verification is reported as passed.

The first added cascade test had a PostCSS parent-node type annotation error;
fresh typechecking detected it. The annotation now includes Document parents,
without changing production code or assertions, and the final check is rerun.

## Acceptance boundary and next step

Full combined verification, Worker generation/typecheck, native-browser
normal/direct/return/re-entry at 320/390/1280, light/dark/dot rendering and actual
device fetch/decode timing remain separate. No native process or known blocked
socket was retried. Resource bytes do not prove a speedup in milliseconds.

Next: independent review of this corrected boundary, final combined verify,
then browser/render acceptance only in an authorized supported environment.
No publication, PR, merge, deployment, or branch deletion has been performed.

## Production-boundary browser regression prepared

`tests/e2e/admin-style-loading.spec.mjs` uses the ordinary built app on the
existing preview server, not the static administrator development harness. It
checks that normal `/terms` has no console CSS rules/request; then the real
`/admin` lazy import is held specifically at its emitted AdminApp stylesheet.
While pending, only Suspense status may appear. After releasing the unchanged
CSS response, the real unauthenticated admin surface must render.

The test explicitly labels its three injected panel class pairs as CSS probes,
not authenticated overview data. Actual computed four-side padding must match
10/12/12/14/14px at 320/390/600/900/1280, in light/dark and standard/dot. Returning
to the ordinary page must keep its pre-admin computed card styles, document and
appearance; re-entry must reuse the loaded stylesheet. A fifth case checks cold
`/admin` entry. Screenshot and numeric probe attachments identify this evidence.
No real account, auth bypass, remote API, CSS replacement or production fixture
was added. The existing cross-browser match includes this same spec.

Syntax and collection only are verified locally: 5 Chromium and 20 cross-browser
cases (the same 5 across Chromium/Firefox/WebKit desktop/mobile). Native execution
is delegated to the release coordinator's CI; collection is not a browser pass.
