# Desktop report readability

Status: active, local candidate only; rendered acceptance pending

## Ownership and checkpoint

- Branch: `fix/report-desktop-readability`; exact base: `e6a18d0dc12422c50ad65d15ece4f298bdcaf581`, tree `5cfbb2836a171931d3166961367b3195e72eee9d`.
- Existing reporting scope: UI request 15 / #483. Prior compact report #686 and pixel-control #559 are merged. Current open #707 owns period navigation motion in `ReportView.tsx` and an `overflow-x: clip` addition on the report's trend/empty cards. This change owns only desktop width/type; it does not edit the component, navigation, motion, overflow or shared shell.
- Preflight: official main, 32 open PRs and report owners checked on 2026-10-17 at 14:10–14:15 UTC. No competing desktop report layout owner found. No remote branch, Issue or PR created; no publication is authorized.
- Next: add focused CSS contracts and desktop native definitions, make the bounded CSS change, run only relevant checks, then independent diff review. Native browser execution is unavailable in this task and must remain explicitly unverified.

## Evidence and decision

Actual accepted-tree Chromium screenshots were recovered from Browser Regression results for source `73225b408ab7bde31dac3e1363ce0f4a01d79b69` (same tree as the base), artifact `12101063962`. Both `compact report overview and disclosure across sizes in standard/pixel` passed at retry 0. Their 1280×800 month-scope attachments show the entire initial overview above the bottom navigation. Thus there is no reproduced first-screen overflow at that size.

The same images and CSS show a 760px report cap inside the existing 1040px shell, with helper/chart labels at 9.6–12.48px at the default root size. Three options were compared:

1. Keep the current width and only add missing desktop acceptance. Lowest change risk, but leaves the source-confirmed narrow data canvas and small labels.
2. Use more of the existing shell and raise desktop helper fonts. Selected: a report-only breakpoint at 1100px, 960px report cap, and rem-based 14px default helper floor. Existing chart sizing, equal plot rows, disclosure and normal document scrolling remain authoritative.
3. Introduce columns or a viewport-locked dashboard. Rejected: more structural risk, conflicts with progressive disclosure and would hide rather than solve enlarged-text overflow.

The claim is improved desktop width/readability, not a previously reproduced one-screen failure. The 1100px breakpoint deliberately leaves mobile and 1024px tablet styles unchanged. No fixed height or overflow clipping is added. Widening is bounded by the existing shell rather than making explanatory prose span the entire monitor.

## Required acceptance

At 1280×720, 1440×900 and 1920×1080, normal-size populated day/week/month overviews must keep controls, chart, detail disclosure and bottom navigation reachable without document scrolling or horizontal overflow. Pixel-font light/dark fixtures must record the actual viewport, DPR, font and element/text bounds, and verify the new label floor and chart-value separation. Keyboard disclosure must still work. At 200% root text, vertical growth is allowed and content must remain reachable rather than clipped. Existing standard/pixel mobile and 1280×800 definitions stay intact.

Exact-size post-change rendering, screenshots, physical-device behavior and visual contrast are not yet verified. Collection and CSS contracts cannot establish those outcomes. Expanded details are intentionally not required to fit in one screen.

## Local verification checkpoint — 2026-10-17 14:22 UTC

- Product delta is a single appended desktop media block in `report.css`: data canvas cap 960px within the unchanged 1040px shell, disclosed content cap 760px, twelve helper/value selectors at 0.875rem (14px at the default root size). No existing CSS bytes, component, state, arithmetic, fixture seed, runner or shared style changed.
- New CSS regressions failed against unmodified CSS (2 failed / 1 existing passed), then report CSS/pixel appearance/component/aggregation checks passed 30 tests across 4 files. Initial app typechecking caught an un-narrowed PostCSS node in the new test; an explicit `AtRule` type predicate corrected it. The final three CSS tests and fresh non-incremental app typecheck passed. Production build passed in 5.41s; its runtime inputs remain identical after the test-only typing/diagnostic additions. No lint script is configured.
- Existing native report spec gains six definitions: 1280×720, 1440×900, 1920×1080 × light/dark, loaded pixel font, dense day/week/month values, axis/value bounds, first-screen controls/disclosure, and keyboard-opened 200% detail text. Screenshots and metrics are attached by the definitions; they have not been rendered in this task.
- Native syntax and exact related-file collection passed. All 8 original identities remain and 6 are added without duplicates in both standard Chromium and the existing mobile-WebKit configuration. The latter retains its mobile UA/DPR even at a wide viewport and is not desktop-Safari evidence. Current configuration does not select this spec for desktop Firefox/WebKit; no workflow or runner admission was widened.
- Node24.19.0, installed Vitest3.2.7 / Playwright1.64.0, existing dependency trees reused without installation. Full suites, browser launch, CI dispatch, public writes and merge were excluded by the current related-tests-only/local instruction.
- Evidence receipt and original 1280×800 pixels are retained outside the repository. Independent source review is pending. Source tests and collection do not close visual acceptance.

## Source review follow-up — 2026-10-17 14:28 UTC

Independent source review found no blocking layout or ownership issue. Raising the numeric font changes the em-based plot reservation, so only equal bar scale/formulas are preserved, not identical absolute pixel geometry. The enlarged-text native check covers the first disclosed breakdown title and keyboard disclosure; it does not establish 200% containment of every chart label/value or every detail row. Exact-size desktop Firefox/WebKit remain unverified. At the reviewer's request, enlarged metrics/screenshots are now attached before geometry assertions so failures retain diagnostics. The six test identities and every assertion are unchanged; syntax was rechecked after this diagnostic-order-only edit.

## PR #737 native correction: dark emphasized text

The first bounded native run on source `fb018e4` (tree `638cc9aa`) passed all
14 Report geometry cases in Chromium, but actual dark screenshots exposed weak
chart-value and disclosure text. The solid chart foreground `#2f8f84` against
observed pixel paper `#1c2d34` has a 3.651:1 contrast ratio. Larger placement alone
did not address this small-text readability problem.

A separate correction based on the same integration tree changes only three dark
text selectors (chart values, details disclosure and insight heading) to the
existing body-text token. The selected day/week/month tab is a fourth, separately
verified case: its actual white ink against `#59b7ab` measures only 2.390:1.
Dark selected tabs now use the existing selected-surface/body-text token pair;
the native check composites that translucent surface over its opaque parent
paper before measuring contrast. Light colors, bars, typography, geometry, data and
scroll ownership stay unchanged. With the current dark body token `#e8f2ef`, the
same observed background gives 12.466:1. This arithmetic is evidence for the
observed colors, not a universal contrast certificate for every theme or paint
layer. The native matrix now records actual computed ink/paper colors, requires
opaque colors, checks at least 4.5:1 against the opaque pixel chart paper and
checks dark emphasized text matches body text. Wallpaper and gradient paint
still require image review.

Alternatives considered: enlarging these labels alone would alter geometry and
would not fix the dark token; globally changing the accent would affect other
screens; a Report-only dark body-text override directly addresses the observed
failure with the smallest color-only scope.

The WebKit-mobile project also timed out on its first 1920×1080 light fixture,
then passed on retry. Trace evidence shows all three scope screenshots and the
200% full-page screenshot completed, consuming 17.17 seconds of the 30-second
budget; the deadline arrived near the final disclosure close. This remains a
failed/flaky acceptance result. The six desktop definitions now capture at CSS
pixel scale instead of device pixel scale. The mobile project's DPR, viewport,
DOM geometry, keyboard checks, assertions and timeout are unchanged. This avoids
encoding nine image pixels per CSS pixel at DPR 3; its effectiveness still needs
a fresh native run. It does not change existing mobile-only cases.

Local verification for the correction:
- Initial direct Vitest startup could not enumerate network interfaces. Supplying
  the repository-supported explicit loopback development host avoided that unused
  discovery step; no browser/server was started.
- Exact new source regression before CSS fix: 1 failed, existing 3 passed.
- Related Report style/component and pixel style tests: 3 files, 14 passed.
- Fresh application typecheck passed before the final selected-tab test was added;
  final combined typecheck remains with the integration owner.
- Selected-tab regression: 1 failed/4 existing passed before the tab fix, then
  all 5 style cases passed. Final native syntax and collection passed.
- No local browser launch or native pass is claimed. The publisher owns the
  combined build and fresh Chromium/mobile Report acceptance, including the
  previously flaky case and dark image review. Do not accept a retry pass as a
  clean first-attempt result.
