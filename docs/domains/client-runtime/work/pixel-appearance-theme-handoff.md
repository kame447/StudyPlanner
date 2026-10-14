# Optional pixel appearance

Status: current-main build and scoped verification recorded; exact published-head CI pending
Branch: `feat/pixel-appearance-theme`
Current base: `32623e36f1ebf06058a16f6233514144dee467b3` (Laplans name/icon released)
Runtime candidate: `bb980207bdd441e612003e1aeefcb9ba143f2d7d`
Latest source/test candidate: `dae8cb97ce644d8b1df5fd87d4956d63947938d0`
Combined runtime with #540: `38580203fae2d3e35bcb9468a0993e5fb18feea8` (later test-only merges do not alter the built application)
PR: none from this implementation task. Publication/CI/main/deployment are authorized separately through the release owner; this task hands over the verified local candidate.

## Scope and ownership

The scope is all normal-user application screens. The separate `/admin` entry and AdminApp are excluded; their authentication, authorization and appearance remain unchanged.

Standard/dot appearance is selectable in the existing design settings. Standard remains the default. Palette, light/dark mode and Home illustration remain independent browser preferences. The new choice uses localStorage, with no Firestore reads and no startup font gate. It follows the existing Home illustration save-failure contract: retain the last saved selection and show an error. Owner changes retain this browser-wide presentation preference.

Only the approved visual overlay was ported: font, background paint, frames and SVG edge rendering. No preview adapters, seeded data or CSP enter the app; no AI implementation/dedicated tests or Orrery code were modified. Existing routes, handlers, sizes, spacing, layout and target areas are unchanged outside the added settings row. Font metrics naturally differ from the standard system font; the paint-only comparison deliberately holds the font constant.

Existing open/closed theme-related Issues and active branches/PRs were checked. No other active task implements this appearance. PR #550 owns separate recovery and responsive text work and must not be overwritten. Its final changes are included through a normal merge, without conflicts or edits to its recovery logic.

## Loading and font license

The optional stylesheet is dynamically imported only while dot appearance is selected. Its selectors are all appearance-scoped. A late CSS or font response cannot re-enable dot styling after the user selects standard. CSS download failure is announced in settings; font download failure falls back to system fonts. The original pending/rejected import Promise is retained across selections because Vite caches preload URLs before completion. Switching to standard and then selecting dot again therefore cannot discard a prior or eventual load failure; successful retry after reload is independently verified. Neither prevents using the app or switching back.

The self-hosted DotGothic16 font and OFL 1.1 license are in `public/fonts`. Offline FontTools WOFF2 conversion reduced 2,069,236 TTF bytes to 500,340 bytes without subsetting. All 9,362 glyph drawing commands, 8,231 cmap entries, horizontal/vertical metrics and naming/layout tables match the source. No user text or external font API was used. The converted file SHA-256 is `ba8513004fcb6c03c831d7eefd7fffe457426346820054a2481c278076796b32`.

## Historical local validation (before workspace replacement)

- 34 focused tests (including optional CSS/font budget boundary, overage and missing-asset guards): preference defaults, remount/owner changes, repeated selection, corrupt storage, blocked reads/writes, recovery, independent illustration storage, settings semantics and scoped paint-only CSS.
- Fresh app typecheck and production build pass. A concurrent verification attempt exited 137 without diagnostics; after browser/build work was serialized, the fresh non-incremental app typecheck passed. No configured lint task. Worker sources/types and the complete unrelated test suite were not run for this visual-only change.
- Chrome Headless Shell 155.0.8059.39 / Playwright 1.62.1: 15 browser cases (including failed/pending stylesheet reselection regressions). Includes existing settings navigation at 320/390/1280, appearance keyboard/reload/repeated changes/exact standard CSS restoration at 320/390/844/1280, all five palettes in both modes, illustration independence, failed/delayed font/CSS and local-save recovery.
- WebKit 26.5/Linux MiniBrowser, iPhone 13 emulation at 390×844: eight focused cases pass for keyboard selection/reload/standard restoration, failed/delayed font/CSS, local-save recovery and both stylesheet reselection races. This is browser-engine evidence, not a physical iPhone/Safari or real-rotation result.
- On the real production build with synthetic local repository records, standard requests no dot stylesheet or font. Home/settings/month/materials/timetable/AI display at 320×568, 390×844 and 1280×844 were inspected with the actual DotGothic16 face verified loaded. All visible text uses the requested font family and there is no horizontal document overflow. These real-font checks are distinct from the 18 same-font paint comparisons, which preserve every element rectangle. AI was only opened for visual inspection; no AI turn or external provider request was made.
- Chrome serialized the desktop AI shell's auto margin as `0px 92.5px` versus `0px` during the paint-only comparison; its complete rectangle remained `[92.5, 0, 1080, 844]`. The audit records this CSSOM difference rather than treating shorthand serialization as geometry. The CSS source test separately prohibits margin/spacing rules.
- At 320×568 with a long title, metadata line-box and CTA box intersect by 2.078125px in both the independently built unchanged main and the candidate. All five hero rectangles are identical, CTA hit-testing passes, and independent image review found no glyph clipping or button obstruction. This existing box boundary is recorded, not presented as a new theme fix or hidden by a tolerance.
- Screenshots of settings/Home/materials and the font rendering were inspected.

## Bytes and explicit feature budget calibration

Compared with an independently built unchanged exact base and the same lock/toolchain:

| Metric | Base | Candidate | Change |
| --- | ---: | ---: | ---: |
| All JavaScript raw | 2,252,773 | 2,254,532 | +1,759 |
| All JavaScript gzip | 606,667 | 607,104 | +437 |
| All CSS raw | 484,822 | 491,546 | +6,724 |
| All CSS gzip | 81,527 | 83,236 | +1,709 |
| Largest CSS raw | 424,294 | 424,294 | 0 |
| Largest CSS gzip | 68,862 | 68,862 | 0 |

Standard initial navigation made the same 24 script requests with +1,759 raw/+436 gzip-equivalent bytes. Its 4 stylesheet requests remain byte-identical: 438,652 raw/72,676 gzip-equivalent, with zero font requests. Dot selection adds exactly one 6,724-byte stylesheet (1,709 gzip-equivalent) and one 500,340-byte WOFF2 font (497,817 gzip-equivalent). Gzip-equivalent is a local compression calculation, not an assertion about production response encoding.

The old aggregate CSS raw guard was 485,000 bytes; the latest-base candidate exceeds it by 6,546 bytes. The explicitly approved feature baseline raises only that aggregate raw limit to 493,000 (+8,000). All CSS gzip, largest-CSS, JavaScript raw and per-chunk limits remain unchanged. The aggregate JavaScript gzip exception for the explicit #540 combination is documented below. Independent guards also bound the optional stylesheet to 8,000 raw bytes and WOFF2 to 512,000 bytes, and reject missing assets. The calibrated checker passes the post-PR #550 integrated candidate: CSS 491,546, optional CSS 6,724 and WOFF2 500,340 bytes.

## Remaining acceptance / next action

- The pre-replacement local acceptance above is historical. The reconstructed candidate has its own results below. The release owner owns authorized draft PR publication, complete verification/CI, current-main integration and deployment verification.
- Full CI, physical iOS/Samsung devices, authenticated production accounts and cross-device synchronization are not verified by these local checks.
- This implementation task did not create a remote branch, Issue or PR, or change main/deploy production. Release publication follows through the designated writer.


## Reconstructed post-backup verification checkpoint

The durable source is Library version 1, candidate d938e3bf on main 5e19. The later local fixture commit 8ca7a779 and temporary combination commit eb96997c were observed before the execution workspace was replaced; these hashes are historical evidence, not the identity of this reconstruction.

Before that replacement, a fresh combined build of #540 da3fe1a0 and the theme measured JavaScript 2,258,442 raw / 608,201 gzip and CSS 491,702 raw / 83,275 gzip. The original aggregate JS gzip limit 608,000 was exceeded by 201 bytes; every other limit passed. #540 alone measured 607,842 gzip, so the necessary settings UI and failure-aware lazy loader add 359 gzip bytes in combination.

Only JS aggregate gzip 608,000 -> 608,500 is explicitly approved for that cost. Raw, per-chunk, CSS gzip and optional CSS 8,000 / font 512,000 bounds remain unchanged. This 500-byte allowance excludes unrelated #541/#351 changes. The reconstructed tree must be rebuilt and rechecked; historical results are not new passes.

The App bookshelf-handoff and Home-clock test fixtures each receive only documentElement.dataset. All original assertions and production code remain unchanged. Before workspace replacement, the original 10 failures became 19/19 passes, and the broader App/root startup suite passed 109 tests. These tests must be rerun after reconstruction.

The pre-replacement combined CTA check passed 12 actual-font cases (320/390 × light/dark × empty/study/class), same-font action geometry, target separation/hit and distinct start/inspect behavior. No new paint selector was yet applied. The new secondary .home-plan-inspect had zero radius and DotGothic16 but retained its ordinary background/border and no inner shadow; adding it to the existing ghost paint selector group is only a proposal pending visual revalidation.

The writer subsequently authorized the single .home-plan-inspect addition to the existing ghost paint group. The reconstruction applies that paint-only selector; its dimensions, handlers and ordinary theme remain unchanged. This addition needs new combined build/browser evidence.

## Additional all-page appearance coverage

The post-recovery visual audit confirmed that day/ToDo/report/legal/auth surfaces were using DotGothic16 but retained ordinary rounded cards. Their actual DOM selectors now share the existing paint-only frame/quiet-line rules. Pinned ToDo background and border colors remain under the original semantic-state rules. No margin, padding, font size, handler or element hierarchy was changed for these surfaces.

Initial consent and week-start screens can render before App exists. A common AppearanceProvider now owns the browser-local choice above that startup boundary, while the standalone App entry uses the same boundary. An inner provider reuses the current owner instead of creating another preference state or import. Authentication, consent and startup readiness logic are unchanged; only the existing local appearance key is read before App entry, with no Firestore preference read or font-ready gate.

After this change, 129 focused/App/startup tests passed, including one read/import for nested startup/App ownership, shared selection/failure state and the existing startup/owner/splash contracts. The new browser and combined-asset results below are distinct from pre-recovery receipts.


## Current reconstructed verification (2026-10-09)

Installed dependencies were prepared once by the release owner: all 237 actual package versions match the unchanged lock. Browser evidence uses Playwright 1.62.1, Chrome Headless Shell 155 and WebKit 26.5 Linux MiniBrowser with Japanese locale, Asia/Tokyo timezone and reduced motion. Runs were serialized; no physical iPhone/Safari, Samsung device or real screen rotation is claimed.

- 129 focused preference/provider/paint/budget/App/root tests passed. The two incomplete App document fixtures contain only the missing documentElement.dataset; their original assertions are unchanged.
- Production build and every approved bundle guard passed. Combined #540 + current runtime: JavaScript 2,258,852 raw / 608,401 gzip; CSS 491,977 raw / 83,369 gzip; largest CSS 424,450 raw / 68,901 gzip. Optional CSS is 6,999 raw bytes and self-hosted WOFF2 is 500,340 bytes. Aggregate JS gzip has 99 bytes of headroom; subsequent name/icon integration must be measured, not assumed.
- Chrome completed the 15 original settings/appearance cases and the three new cold-start cases. After strengthening viewport checks and splitting the palette modes, all six changed cases passed again. This represents 19 distinct final cases, not 24 distinct scenarios. Existing keyboard/reload/rapid selection/exact standard restoration, all five palettes in both modes, independent illustration selection, blocked/delayed font/CSS, persistent CSS failure across reselection, and storage-failure recovery assertions are maintained.
- WebKit completed cold standard consent, pixel consent and pixel week-start before App is mounted, plus eight original appearance cases. Added initial-context width tests verify innerWidth, documentElement.clientWidth, visualViewport.width and exact-width media query at 320/390/844/1280. All 16 distinct final theme/cold cases are covered across the recorded runs. Both modes explicitly transition from the opposite mode, with all original ten palette/mode assertions retained.
- One initial WebKit 320 run failed the existing five-second Home assertion while the ready-only splash skip click was in progress. Trace shows the button existed and was stable; click completion arrived after the assertion deadline, and the failure screenshot showed Home. A CPU-isolated rerun passed unchanged. This is recorded as a transient startup-action timing failure, not a first-attempt/flaky-zero run; neither the shared startup fixture nor timeout was changed.
- The former single ten-palette/mode WebKit test reached its total 30-second case deadline near the final palette, without a failed appearance assertion. Splitting by light/dark preserves every combination and assertion, keeps the same deadline and explicitly tests both actual mode transitions. Final mode cases pass in 21.1 and 27.1 seconds.
- Independent secondary audit: 48 actual-font states across 320/390/768/1280 for week/day/ToDo/report/legal/auth. Font loaded, no visible font-family omissions, no horizontal overflow, no page errors or external requests, and unchanged saved data. Newly covered surfaces have pixel frames and zero radii. Pinned yellow background/border stay identical; standard→pixel→standard restores every measured ToDo style/rectangle exactly. Source and image review found no remaining theme-specific issue.
- The pre-App cold cases observe zero optional CSS/font requests for standard, exactly one each for pixel and actual loaded glyphs, while consent/week screens remain interactive without App. They use the existing synthetic startup harness, not real authentication/AI requests. The optional missing-week query does not alter the harness's default fixture.
- Both theme specs are now explicitly selected for WebKit-mobile CI, in addition to the existing tests. The #540 and existing AI test selection/behavior is preserved. No timeout or behavioral assertion is weakened.

The existing report numeric ellipsis and narrow month-chart date clipping occur in standard as well and are not part of this appearance change. The earlier 18 same-font paint comparisons remain historical and are not described as fresh real-font checks. Fresh combined CTA and type results follow below.


### Final local CTA receipt

The reconstructed production build passed 12 actual-font Home CTA conditions: empty/study/class × light/dark × 320×568/390×844. Each verified the loaded DotGothic16 face, no font-family omissions or horizontal overflow, actual primary/secondary hit-testing, preserved plans/actuals, and distinct inspect versus start behavior. The secondary CTA now uses the same quiet double-line paint as other ghost buttons. The separate same-font paint comparison found zero changed Home element rectangles in all 12 conditions.

The new audit initially counted a finished fill-both animation as active; correcting only its readiness query to running finite animations resolved that harness mistake. It also initially assumed a 44px minimum for single CTAs, while the unchanged home-fit.css intentionally permits 37px on a short 320px screen. That original boundary is retained: single-CTA geometry must match standard exactly; both dual CTAs remain at least 44px and separated. No production sizing or existing test assertion changed. Final CTA images were inspected at 320 light/dark.


Fresh non-incremental app typecheck (`npm run typecheck:app:full`) passed on the final combined runtime/test snapshot f458094d, tree 0ae96c7e, with exit code 0 saved separately. An earlier invocation had no diagnostics but its completion session became unavailable, so that invocation is not counted as a pass. The confirmed run explicitly persists its exit receipt. This implementation worker did not rerun the entire unrelated unit suite or Worker checks; final full verify and all publication gates remain the integration owner's responsibility.

Release handoff: normally merge the latest main (#551 Laplans name/icon) and final #540 without overwriting their runtime/CI selections, then measure final assets against the unchanged approved 493,000 CSS raw / 608,500 JS gzip feature bounds. Preserve every other guard. The current 99-byte JS gzip headroom is not permission to increase the cap. Name/logo source and the latest mixed-source budget need new integration evidence. Keep this local scope distinct from remote CI, main and production verification.


## Current-main publication checkpoint

The released Laplans name/icon main `32623e36` was merged normally without conflicts. The resulting standalone theme input is `ebf3984e`, tree `47cf91dc`; it does not include the unplanned-study feature from #540. A new production build on these inputs passed in 11.91 seconds, as did every asset guard. JavaScript measures 2,254,854 raw / 607,216 gzip; CSS 491,880 raw / 83,351 gzip; largest CSS 424,353 raw / 68,883 gzip. The selection-only stylesheet is 6,999 bytes and the font remains 500,340 bytes. All are inside the approved 493,000 CSS raw / 608,500 JS gzip and 8,000 stylesheet / 512,000 font limits; every other limit is unchanged.

The exact, independently reviewed four-project CI partition from #540 is reused solely as verification infrastructure. Its workflow SHA-256 is `0f6e3e0fa36393e75de980398c2f19901ebbc982fe8f24834eccacd4a9821a2f`. It preserves the existing aggregate check, original project set, per-project timeout, assertions, retries and artifact conditions, with fail-fast disabled. This is intentionally the same infrastructure diff as #540 and must disappear from the theme's main-relative diff once that change is on main. No #540 feature implementation is copied into this standalone theme branch.

Both new appearance specs are explicitly selected in mobile WebKit CI. Collection on current main confirms 174 mobile cases including all 16 appearance cases, plus the existing three 69-case desktop projects (381 total). The width cases create contexts at their actual initial viewport and assert layout/visual viewport and media-query state, rather than treating innerWidth alone as a real resize. The two palette-mode cases retain all ten palette/mode combinations and explicit opposite-mode transitions, with the original per-case deadline and behavioral assertions.

The local implementation checks above remain their precisely scoped evidence. The name/icon integration changes the base and has this new build/asset measurement; the final exact published head still needs full application/Worker types, all unit/rules tests, browser/visual checks and deployment verification in CI. Physical-device installed-PWA behavior and existing Home Screen icon refresh remain unverified.


## Report control paint follow-up — local ownership checkpoint (2026-10-09)

- Owner: existing Issue #483 and the report-appearance follow-up to merged PR #552. This continues the existing appearance handoff; it does not create a new Issue or duplicate the theme implementation.
- Local branch: `fix/pixel-report-control-paint`; base main `1207f1a842a59ca958b2a497a868b10a2d82770f`, tree `e87ca1829f6f89559a36c56ea8deaa167679505d`. The previous theme release is already merged. This section records a new, separately unverified local correction.
- Before implementation, the owner checked existing Issue #483 body/comments, open PRs, related closed PR #552/#554 and remote branches, and found no active owner for this exact report-paint scope.
- Report `.learning-report-scope-tabs` and `.learning-report-material-filter` retain their ordinary 14px rounded paint in pixel mode because the two wrappers are absent from the existing quiet-line appearance selector. The source and baseline screenshot observation are the starting evidence; this checkpoint does not claim a tested fix.
- Proposed scope: add only these two wrappers to the existing quiet-line pixel-paint selector. Preserve DOM, handlers, view routing, dimensions, layout, standard-theme styling and existing report data behavior. Do not change `report.css` geometry or remove rounded styling globally.
- Keep the previously observed report time-value ellipsis and narrow monthly date crowding separate. They are not the target of this two-wrapper correction.
- Required local evidence: reproduce the old paint, verify both corrected wrappers with standard/pixel and relevant widths/modes, compare layout/computed geometry and interaction preservation, then run the relevant focused checks and unchanged asset guards. Record failures and limits before any completed claim.
- Status: pre-implementation ownership checkpoint only. No new test success, publication, merge, production deployment, real account/data action or physical-device result is claimed. Public release authorization is not expanded by this local checkpoint.


## Report control paint — selected local verification (2026-10-09)

The follow-up adds `.learning-report-scope-tabs` and `.learning-report-material-filter` only to the existing quiet-line appearance selector, and adds those two names to the existing stylesheet coverage test. The ordinary report stylesheet, DOM, handlers, data calculations and layout rules are unchanged. The current source is a local candidate on base main `1207f1a`; no publication or main/deployment result is claimed here.

- Regression before/after: the existing stylesheet suite reports 1 failed / 2 passed before the addition, then 3 passed after it. No timeout/assertion weakening.
- Chromium 155.0.8059.39: baseline and candidate each execute 20 conditions (standard/pixel × light/dark × 320/390/412/768/1280). All report DOM rectangles and content are identical. Standard appearance has zero computed-style changes. Pixel changes are confined to the two wrappers' background/border colors, corner-radius properties (including logical aliases) and box shadow. No unexpected differences remain.
- Scope tabs retain 46px height; the material filter retains 48px. All four appearance/mode combinations retain working tab/filter operations and unchanged saved synthetic data. Page errors and external requests are zero.
- Mobile-profile WebKit 26.5 at 390px: baseline and candidate each pass light/dark, with identical wrapper rectangles, successful taps/filter operations and the intended 14px → 0px pixel radii. This is two comparisons/four executions, not proof across every Chromium width or physical Safari.
- Production build and every current asset guard pass: JavaScript gzip 607,107 B, optional appearance CSS 7,060 B, font 500,340 B. Thresholds and dependencies are not changed.
- The first comparison classifier treated equivalent logical border-color/radius aliases as unexpected because only physical CSS property names were allowlisted. Correcting that paint-property classification produced zero unexpected differences; no product source or assertion was loosened to hide a layout change. The raw before/after captures preserve these differences.

Evidence is in `ui-report-current-audit/paint-comparison-summary.json`, `webkit-comparison-summary.json`, `paint-red.log`, `paint-green.log`, `candidate-build.log`, `candidate-budget.log` and the before/after images. These are local synthetic-browser observations. The immutable release backup should include the actual files and hashes before public handoff.

Frozen implementation hashes:
- `src/styles/appearance-pixel.css`: `b016da5481e25ab9a97ddeb5d6218c283a63430bcc3c83033649dec00daafdb4`
- `src/styles/appearance-pixel.test.ts`: `801be9dfc35735985683ec3d1f201492af157cdba68b2fac090f273120c2c538`

UNVERIFIED: full application/Worker verification, exact-head remote CI, public release and physical-device behavior have not been established by this local task. The existing report time-value ellipsis and narrow monthly date labels remain separate, unchanged issues. Do not substitute the previous full theme release's successful gates for this new candidate.
