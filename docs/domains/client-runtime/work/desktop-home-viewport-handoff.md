# Desktop Home viewport and readability

Status: combined local candidate; publication and rendered acceptance pending
Base: 219019abf8c24f106dac5aaa65ae5f5f8a91387c
Branch: fix/desktop-home-viewport

## Scope and ownership

The current user request calls for a balanced desktop viewport, legible next-plan
text, and investigation of startup sizing. Home's desktop layout is owned here;
AI content and Study/Report/settings are separate coordinated lanes. Existing
motion PRs #702, #705 and #708 retain component/motion ownership. PR #729 delivery
recovery and its progress-ring correction remain a separate release.

## Observed baseline

Actual CI screenshots from PR #729 head 22db200e / merge 676e9ebc show Home at
1280×720 and 1920×1080. The former uses a stretched single column with a 15.36px
next-plan title and 9.28px metadata, matching the active width≥700/height≤850
CSS. The latter retains the 1080px shell cap and distributes spare vertical room
through the one-column fit algorithm. No 1440×900 screenshot was available.

Three explanations were compared: user-data length, an incorrect desktop layout
policy, and a browser/zoom-specific rendering failure. Short synthetic titles
also show tiny type in the native baseline, while the CSS explicitly chooses
these sizes on desktop. Layout policy is the strongest supported cause. Long
content and enlarged text remain separate accessibility cases and must scroll.

## Local correction

Use two columns for the four existing core Home sections on desktop (≥1200px),
restore readable next-plan and supporting type, and stop the phone-only vertical
fit/relaxation calculation on that layout. Keep the original components, actions,
semantic order, mobile layout, and shared header/footer geometry. Excess content
must remain reachable by scrolling the Home body; do not reduce type to fit.

Startup uses a supplied portrait video with object-fit:contain. Its intended
size complaint is not yet reproduced. Do not crop or stretch that artwork based
only on inference. Local native browser launch remains denied; no retry or
workaround is authorized. Existing CI screenshots and source checks are the
current evidence; new 1280×720, 1440×900, 1920×1080 native screenshots and mobile/
enlarged-text checks are required before claiming the visual outcome is fixed.

The local change stops desktop vertical relaxation, keeps one supplemental
material row, arranges the existing sections in semantic reading order, and
caps the normal schedule list rather than stretching cards with spare height.
Shared shell/header/footer widths remain unchanged. The existing chart
summary/legend/axis and shared footer label sizes are also unchanged; this
candidate does not establish a blanket minimum font size for the entire Home. At enlarged text the list
returns to natural height and the Home body remains the scroll owner.

## Verification checkpoint

- Five related unit/source files passed 35 tests before review adjustments.
- The two changed test/source files were rerun after the final layout and
  hidden-desktop guard adjustments: 10 passed. A further CSS cascade guard (in-flow inspection actions and
  enlarged-text focus clearance) passed all four source tests after review.
  Alongside seven runtime tests and 26 unchanged tests, this is 37 distinct
  related tests, not a whole-suite run.
- A first desktop-to-phone test missed the next animation frame that removes
  the old supplemental row. It now dispatches the actual registered resize
  listener and flushes both expected phases; runtime code was unchanged.
- Type feedback caught use of Array.at in the test, unsupported by this repo's
  lib target. Replaced with indexed access; no compiler configuration changes.
- The existing browser spec retains long-title, 200% text, keyboard/focus and
  retained-history cases, adds 1440×900, and adds six desktop light/dark cases.
  The long-list fixture has ten rows so scroll assertions are meaningful even
  on the tallest requested viewport. Collection: 23 standard Chromium plus
  23 mobile WebKit definitions, zero errors. Collection is not execution.
- Syntax and diff whitespace checks pass. Fresh app typecheck recorded in the
  exact local evidence manifest. No native browser, build or full suite was run.

The original Home candidate completed independent exact-input review without a
source blocker. Native screenshots at all three desktop sizes, mobile and 200%
text interaction remain required. Splash sizing and a possible shared desktop
shell width change remain unresolved; do not report those complaints as fixed.


## Combined Home + AI checkpoint (2026-10-17)

- Branch: `integrate/desktop-home-ai`. This is the local composition of Home
  `919e91ad43af4797f13a41bb417fa788c0571cba` and
  [AI presentation](ai-planning-desktop-layout-handoff.md)
  `cd7444fc6805f30603690e056db3c40f5f704188`.
- Runtime base: `9acdc0c2463f1c4b2bcfd2e73ff8a1b6ed05c0f3`, tree
  `5cfbb2836a171931d3166961367b3195e72eee9d`. This is the exact local tree of
  PR #729 correction 4, remote `73225b408ab7bde31dac3e1363ce0f4a01d79b69`,
  and includes verified main `b1ee5e0389fd44c1dd81c3272da28bcf66968adc`.
  It is a pending-runtime-based preview candidate, not a claim that #729 merged.
- All reviewed production Home/AI files are byte-preserved. The shared README
  retains every prior entry plus both new links. Existing root/navigation/error
  guards, the progress-ring fix, motion-owned components, package manifests and
  Vite configuration remain byte-identical to the runtime base.
- The only further test changes add explicit light/dark theme setup and resolved
  theme evidence to the AI desktop cases, and resolved-theme/geometry evidence
  to Home. Preventive AI-header viewport bounds preserve the shared chrome
  boundary. The suspected Home selector collision was rejected after inspecting
  the actual JSX: the primary header is a sibling of main, not its child; no CSS
  repair was needed. Home's normal screenshot now precedes the deliberate list scroll.
  No existing geometry, navigation, persistence, retry, timeout or test identity
  is removed. Three legacy readiness checks (AI entry, primary chrome and public
  return) awaited the compact-fit marker even at 1280px. They now require exact
  marker absence on desktop and the exact viewport key below 1200px; all three
  retain or add font/image/stable-geometry readiness before visible assertions.
  The two additional existing specs are included because this runtime boundary
  directly affects them, not as an unrelated broader suite.
- Fresh combined check: **54 tests passed across 10 related files**. Fresh
  non-incremental app types and the production build pass. Emitted CSS contains
  Home's two-column/title rules and both AI width rule groups. The emitted Admin
  import/CSS and its correction-4 preload exclusion remain intact. These are
  source/build checks, not computed-style or native-browser evidence.
- Native collection: **67 standard Chromium definitions** across Home content,
  AI surface, composer viewport, preview viewport-lock, primary chrome and public
  navigation specs; **44 WebKit mobile definitions** across Home content,
  composer viewport and public navigation. The standard
  set contains 18 new desktop cases: three sizes × two themes × Home, AI choices
  and AI populated proposals. Existing mobile, long-title, keyboard, draft,
  history and enlarged-text checks remain selected.
- No full suite, native browser, preview deployment or GitHub write was run for
  this composition. The known browser-launch denial is still respected. The
  build retains its existing large-chunk warning; no bundle-budget claim is made.

Independent composition review bound clean `9ad86be2d05bfc3e4a2ca6e8a36dc13af3681887`
without a source blocker. Next: obtain publication approval and
run the exact related native specs on an authorized runner. Existing manual UI
CI can select one WebKit-mobile spec; its current Chromium workflow has no
related-spec input and would select the full suite for this CSS change. A narrow
manual Chromium route requires a separately approved runner/workflow change;
never label collection or the existing correction-4 preview as Home/AI visual
acceptance. Inspect the three sizes in both themes before declaring the desktop
complaints fixed. Splash experiments are excluded from this candidate.

## Desktop progress-label follow-up (2026-10-17)

- Branch: `fix/desktop-progress-readability`, based on frozen Home + AI
  `9ad86be2d05bfc3e4a2ca6e8a36dc13af3681887`. Official main was independently
  fetched as `e6a18d0dc12422c50ad65d15ece4f298bdcaf581`, tree
  `5cfbb2836a171931d3166961367b3195e72eee9d`. Its content exactly matches the
  frozen candidate's runtime parent, so application has no content conflict.
  The earlier 54-test/type/build proof was not repeated.
- The remaining weekly graph label sizes are a separate confirmed source cause:
  at the default 16px root, axis/day caps are 7.84/8px at all three desktop
  sizes; summary/legend are 9.28/8.32px at 1280×720 and 11.2/9.92px at the
  larger requested sizes. The old native 1280×720 screenshot supports the
  tiny-text complaint; it is not a rendering of this follow-up.
- Three options were compared. Font-only enlargement leaves four 15px axis
  lines in the existing short 42px plot and the day label in a fixed 12px row.
  Scaling the entire chart would also transform the bars and change motion
  ownership. The selected narrow change uses desktop-only 0.75rem labels,
  a 4.5rem plot, intrinsic axis width and day-label height. At enlarged text,
  the chart gets its own full-width row. This gives the text room without
  changing the chart's data domain, percentage heights, ring or bar styles.
  The claim would be disproved by the existing viewport-fit tests or the new
  native text-bounds checks failing; native results remain required.
- The latest #705 head `116daab810128d553dfc54a7939ad2c40154566f` changes motion
  only. Its CSS adds bar transform origins; its DOM/motion keys and percentage
  formula are left untouched. No motion-owned component or stylesheet changes
  here. All new rules remain scoped to Home at width≥1200px; mobile and shared
  chrome keep their current rules. This is not a blanket font-size guarantee:
  the ring suffix, shared footer and other surfaces are outside this follow-up.
- New source regressions first failed as expected (4 existing passed, 2 new
  failed), then the final desktop source and existing progress-ring contracts
  passed **9 tests in 2 files**. Syntax and whitespace checks pass.
- The existing Home native spec gains 12px label floors, actual text-bound
  containment, adjacent axis/day non-overlap, and 24px floors at 200% root text.
  The existing normal body-fit, long-list scrolling, focus, history and mobile
  assertions remain. Collection retains the exact **23 Chromium + 23 mobile
  WebKit identities**, with no duplicates, added retries or removed assertions.
  Collection is not execution. Review additionally keeps the last measured
  label geometry as an attachment even when a polling assertion fails. The
  source-test title was clarified: plot pixel height changes, while the bar
  percentage formula and direct motion/style declarations remain unchanged.
  These review edits change no source-test assertion or native test identity;
  syntax/identity checks cover them without repeating the passing source tests.
  This label acceptance uses the default appearance. A loaded pixel-font
  appearance is not established by these checks.

Independent exact-input review found no source blocker. Next: carry this small
follow-up into the authorized Home/AI preview acceptance. No native browser, full suite,
build/type repetition, GitHub write or publication occurred here. New desktop
pixels, mobile boundaries and 200% text behavior remain unverified. Keep the
original combined candidate frozen until this follow-up is accepted separately.

## Approved four-surface integration (2026-10-17 14:51 UTC)

- The user approved publication and main integration of Home, AI planning,
  Home's weekly graph and [Report readability](../../reporting/work/20261017-desktop-report-readability-handoff.md).
  Branch `integrate/desktop-four-approved` starts from freshly verified official
  main `e6a18d0dc12422c50ad65d15ece4f298bdcaf581` / tree `5cfbb283`.
  Splash experiments, materials and timer candidates are excluded.
- Three logical cherry-picks compose Home/AI `9ad86be2`, graph `2e1371e4` and
  Report `7d4ea90a` without conflicts. The first two intermediate trees exactly
  reproduce the reviewed candidates (`59039674` and `cfd1cc54`). The composed
  product tree is `c948d5a5` at local `436d3077`, before this checkpoint-only
  documentation update. All 20 changed files match the union of owner final
  hashes; all other 2,854 tracked main files remain byte-identical.
- Existing focused tests and fresh app type results are reused only for their
  exact unchanged executable inputs. No whole suite or duplicate source/type
  run was performed. The new combined CSS input warranted one production build,
  which passed in 5.39s. Emitted output contains the Home columns, AI width rules,
  weekly label/plot rules and Report width/type rules. Admin's native import,
  CSS dependency and own-entry preload exclusion remain intact. The existing
  large-chunk and static/dynamic import warnings remain; this is not a bundle
  performance claim.
- QA collected the exact bounded union once: **81 Chromium and 58 mobile-WebKit
  definitions**, retaining the prior 67/44 plus Report's 14/14 without duplicates
  or omissions. Graph checks are already included in Home. The Chromium set
  contains 24 desktop definitions: three sizes × two themes × Home, AI choices,
  AI proposal and Report. Wide viewport cases in a mobile project keep its mobile
  user agent/DPR and do not establish desktop-Safari behavior.
- Independent source composition inspection found no overlap blocker and
  confirmed the reviewed owner hash union. Final receipt binds this checkpoint
  separately; no rendered acceptance is inferred from the source review/build.

Next: the sole publication owner publishes the exact reviewed tree, runs the
bounded native selection through the authorized route, and inspects captures
at 1280×720, 1440×900 and 1920×1080 in both themes. Diagnose every related failure
or flaky result before merge. Normal viewport fit, enlarged text, actual loaded
fonts and visual balance remain open until those results are available. Existing
root/navigation guards and mobile interactions remain required acceptance.

## First native Home corrections (2026-10-17 15:08 UTC)

- PR #737 source `fb018e4` / tree `638cc9aa` reached native rendering. The bounded
  Chromium run passed 79/81 cases; only Home's 1280×720 light/dark normal body-fit
  checks failed on both attempts. Columns, type floors, horizontal bounds and
  document containment passed. Actual images show the bottom material card
  meeting the Home scroll boundary, while Today remains a bounded inner list.
  The original failing test did not attach its numeric scroll/client heights
  before the assertion; the exact excess is therefore unmeasured, not zero.
- Alternatives considered were shrinking type, reducing card content, and
  reducing inter-card whitespace on short desktops. The first two conflict with
  readable text/content reachability. Only the two vertical gaps change from
  12px to 8px at width≥1200px/height≤850px, recovering 8px while preserving card
  floors, chart tracks, fonts, horizontal spacing and the strict body-fit check.
  This is a candidate correction until the same native cases pass. No claim of
  exact required clearance is made from the screenshot alone.
- Automated contrast also failed for the now-visible material progress helper:
  native axe measured `#788399` on `#ffffff`, 12px normal, ratio 3.81 against 4.5.
  The helper inherited an existing light-only color. The desktop override now
  uses the existing `--text-muted` token; light `#5d6c69` clears 4.5 on that white
  background, and dark continues to resolve the same token it already used.
  No font reduction, global theme change or accessibility exclusion is added.
- Two new source regressions failed against the old rules, then all eight
  desktop CSS contracts passed after these changes. Native diagnostics now
  attach actual Home/card/scroll geometry in `finally`, retaining evidence on
  failures as well as success. All native predicates and identities are kept.
- The old visual Home count difference (1 missing / 90 minutes versus 0 / 0)
  predates this work: main's `324106fc` excludes timetable plans by default,
  while the baseline `0d7d657a` predates that policy. Current main/candidate
  fixture, model and policy bytes are identical. Today's thin blue strip is the
  partially visible final add row in its scroll region, not a compressed button;
  full visibility and keyboard/click reachability still require native proof.
  The six existing desktop cases now additionally require the complete scrolled
  add-button rectangle inside the list client area, at least 44px height, and
  its nonempty plus SVG inside that area. This retains the viewport and
  click/focus/Enter checks. Scroll/client heights and both rectangles are attached
  even on failure. A source-only harness rejects partial, short and clipped-icon
  fixtures and preserves diagnostics; it is not native execution.

No baseline image is accepted by this source correction. Re-run the affected
Home/contrast acceptance and inspect new exact-tree captures before replacing
the desktop Home baselines. AI dark-preview readability is a separate parallel
correction; existing passed geometry alone does not establish visual legibility.

## Native dark Home start-label follow-up (2026-10-17 15:26 UTC)

- The same first native desktop images exposed another paint defect: the dark
  primary start label is pure white over the bright accent gradient. The exact
  1440px dark image measured 2.686–3.124:1 across text-bearing rows, while the
  light image measured 6.303–7.612:1. The image hashes, row coordinates and
  samples are preserved with the visual review. A vertical gradient permits
  comparison with unobscured background at the same y-coordinate.
- Alternatives were changing only the text over the existing multi-stop
  gradient, changing the shared accent palette, or using an existing paired
  surface locally. The last has the smallest verifiable scope: desktop dark
  Home's start button uses `--text-primary` on `--surface-selected`. Light,
  mobile, dimensions, focus/active behavior and disabled semantics are untouched.
- The new source assertion failed on the old declarations, then all nine Home
  CSS contracts passed. The three existing dark desktop cases now attach actual
  foreground/background layers and require 4.5:1 both after ancestor alpha
  composition and against conservative white beneath the button's own layer.
  The latter also bounds unknown ancestor gradient pixels. No case identity or
  existing geometry, scrolling or keyboard assertion is removed.
- Native rendering/contrast, short-height fit and full Today add-button
  containment remain pending on the combined corrected tree. This follow-up
  does not approve old baseline images or erase the first-attempt failures.

## Combined native correction checkpoint (2026-10-17 15:30 UTC)

The initial native results remain evidence of failure until the corrected tree
passes the same acceptance. Chromium was 79/81 with two Home 1280×720 body-fit
failures. Mobile was 52 clean passes, three known skips, those same two Home
failures and one Report 1920px light timeout that only passed on retry. Automated
quality found the light Home material helper contrast failure. Actual images
also exposed dark Home CTA, AI preview and Report text/tab contrast problems.

- The combined executable checkpoint is `10fa7b8b` / tree `75c578b6`, based on
  initial approved integration `28ce47f4` / tree `638cc9aa`. It composes reviewed
  Home `750cdbc6` plus CTA `ca7299b3`, Report `f2b96900` and AI `bf685a78`.
  All 13 changed files exactly match their owner commits, and the other 2,862
  tracked initial-release inputs remain unchanged. There were no conflicts.
- Home retains all previous geometry and interactions, adds full 44px Today
  add-button/plus containment and failure diagnostics, and corrects the measured
  short-height/paint defects. The dark CTA correction and its native coverage
  concern standard appearance. Existing pixel-appearance `!important` button
  paint is unchanged; no claim of pixel-appearance contrast repair is made.
- AI supplies component-local dark surfaces/labels/actions, preserves disabled
  navigation differentiation, and adds contrast assertions plus one compact dark
  case. Report pairs dark text/tab tokens and asserts contrast in its existing
  desktop cases. Its screenshots use CSS-pixel encoding to avoid the observed
  DPR3 capture cost; viewport, DPR, timeout, keyboard and geometry stay intact.
- One fresh app typecheck and one combined production build passed (5.34s), using
  the documented `DEV_LAN_HOST=127.0.0.1` input. Exact-byte owner focused results
  are reused rather than rerun: Home nine CSS contracts, AI 17 source contracts,
  and Report 14 focused checks plus the five-test final selected-tab check.
  Emitted output preserves the prior nine layout rules and Admin's native import,
  CSS dependency and own-entry preload exclusion; the seven new correction
  targets are also present. Existing bundle/import warnings remain unchanged.
- The follow-up selection has 48 identities: 22 Chromium, 22 mobile-WebKit,
  two visual and two quality. The first 46 were freshly collected locally on
  this executable tree; the two quality definitions are carried from prior
  actual evidence with their eight inputs unchanged because the local axe
  package is absent. CI must freshly admit all 48 with its existing pinned axe.
  This is a bounded selection, not a repeated whole-suite run.
- No baseline PNG is changed. The old Home 1-count/90-minute expected image
  predates main's timetable-policy change; current fixture/model/policy inputs
  are untouched. Only corrected exact-tree native images, functional scrolling
  and quality results can justify four desktop Home/AI baseline replacements.

Next: the sole publisher runs the mapped native/quality/visual checks, then the
image reviewers examine all three desktop sizes in both themes. Confirm normal
1280px fit, full Today add-button reachability, dark labels/actions and Report
capture stability. Diagnose failures or flakiness rather than accepting retries.
Mobile retention, enlarged text and loaded-font limits remain explicit in the
native receipts; source/type/build success is not rendered acceptance.


## Rendered Home CTA measurement correction (2026-10-17 15:50 UTC)

Correction #1's actual layout and paint are retained. Both quality scans passed;
Chromium passed AI's seven affected cases and Report's six, while mobile's other
19 cases passed on the first attempt. Home 1280px normal fit now passes. The only
six related native failures are dark Home's new contrast helper at three sizes
in each project; its reported 1.063 is not the rendered pixel ratio.

The runtime palette replaces base.css's 94%-opaque selected fallback with a
24%-opaque accent. Every Home ancestor uses dark background images rather than
an opaque backgroundColor. The helper ignored those images and substituted a
white canvas. Independently sampled corrected 1440px image pixels instead give
8.84–9.08:1 for the label. This separates the failed conservative model from the
actual screenshot; it does not discard the native failures or lower 4.5.

Alternatives were parsing arbitrary CSS gradients, changing already-readable
product paint, or sampling the real rendered backdrop. The test now records the
button and direct label Range, captures a small CSS-pixel PNG with only text fill
temporarily transparent, and samples every pixel beneath the recorded label.
Original foreground must be opaque; unexpected shadow/filter/opacity, decode,
scale, transparency, empty/out-of-bounds regions or button/label geometry changes
fail closed. A clamped one-CSS-pixel label margin covers fractional clip rounding.
The normal screenshot is still captured first. The temporary text-fill override
preserves currentColor and layout; all previous fit, scroll, keyboard and action
checks remain. Numeric acceptance stays at minimum 4.5 across the entire label.

The source contract now reads all actual runtime palette tokens rather than
calculating a misleading base.css fallback ratio. Nine related source tests pass.
A source-only execution of the exact native pixel callback accepts the sampled
dark background, rejects low-contrast pixels anywhere under the label, and fails
on invalid image/coordinate inputs. This proves calculation behavior only. The
corrected Home native cases must still execute once through the permitted CI
route, and the corrected image/baseline review remains required. Runtime CSS and
all product code are byte-identical to correction #1; no new build is warranted.


## Scoped desktop baseline adoption (2026-10-17 15:55 UTC)

The image reviewer directly inspected correction #1's four 1440×900 actual PNGs
(Home and empty AI, light/dark; artifact 12105722079, source tree 755939ed) and
approved them as the intended readable two-column Home/three-choice AI layout.
Only those four desktop baseline files are copied byte-for-byte from the first
native attempt; each is identical to its retry image. The other 12 baselines,
thresholds, clocks and fixture data remain unchanged. The old Home progress count
is already explained by the pre-existing timetable-policy change above.

This adoption is explicit and limited: Today initially shows the edge of its
last action within the scrolling list. Full action/plus containment and keyboard
reachability remain native gates; successful light cases do not substitute for
the remaining dark cases. Empty AI baseline images do not test proposal-preview
controls. Home's test-only background-measurement correction changes no product
paint. Any later change affecting a pictured surface requires fresh images.
The final corrected Home native cases, AI light preview CTA, and exact baseline
comparison still have to pass before release; replacing images is not that pass.

## Final narrow correction integration (2026-10-17 15:58 UTC)

The executable checkpoint `d5752d8d` / tree `79c53163` combines the reviewed
Home rendered-background helper `d04b8230`, explicitly reviewed four-image
baseline adoption `ba419066`, and light AI preview CTA correction `42d1d84e`.
All 11 changed paths match their owner commits; the other 2,864 tracked inputs
from correction #1 (`7ebd7b38` / tree `755939ed`) remain byte-identical.

The only product delta is the light v2 preview confirmation button's existing
foreground/background token pair. Image/source measurement had found its old
white-on-blue text at 4.146:1. Home paint, geometry, interactions, Report and dark
AI are untouched in this batch. Home's previous six failures were the incomplete
background model described above; corrected native capture still must prove the
replacement helper and reach the later action checks.

- Exact owner checks are reused: Home nine source contracts plus nine pixel
  callback scenarios; AI 11 source checks plus its hardened contrast probes.
  No type/full-suite rerun is claimed or needed for unchanged app TypeScript.
- The changed AI CSS warranted one combined production build, passing in 6.17s.
  Its emitted light CTA pair, the seven previous correction rules, nine desktop
  layout targets and Admin import/CSS/preload boundary are verified. Existing
  bundle/import warnings remain. No browser was launched locally.
- QA freshly collected exactly 11 final definitions on this executable tree:
  Chromium's three dark Home plus three light AI proposal cases, mobile-WebKit's
  three dark Home cases, and two desktop visual cases. The 1,968 selected input
  hashes include the four adopted baseline PNGs. A missing local ignored runner
  link was resolved by linking the existing runner, without install or browser
  execution; the initial failed collection precondition remains in the receipt.

Next: the sole publisher executes these 11 cases on the exact final source.
Home's six dark cases must pass the actual rendered-background contrast, full
Today add-button and keyboard/action checks. The three light AI cases must pass
the new contrast assertion and existing interaction/geometry checks. Both visual
cases must match the four individually approved baseline images with unchanged
comparison thresholds. Source/build/collection success does not close these
native gates, and retry-only success is not accepted as a clean result.

## Integer capture-boundary correction (2026-10-17 16:20 UTC)

The final 11 native cases passed ten on the first attempt: both visual cases,
all three light AI proposals, the other two Chromium Home sizes and all three
mobile-WebKit Home cases. Only Chromium 1280px dark failed, identically twice,
before contrast: its button is 460.734375×44 at x=146.765625/y=287.546875, while
its element screenshot is 462×45. The prior raw-size ±1 check rejected the
1.265625px width difference. This is a capture enclosure issue, not product scale.
Pinned Playwright 1.64 encloses element document bounds with floor(left+.001)
and ceil(right-.001), explaining that actual image exactly. Five other native
captures and the failing retry are recorded for comparison.

Options were widening a tolerance, retaining backend-dependent element bounds,
or specifying an integer viewport clip from the measured rectangle. The last is
used: `page.screenshot` receives that exact integer clip, the decoded PNG must
match its dimensions exactly, and label coordinates map one-to-one from the
known clip origin. No proportional coordinate stretch remains. The full clip
must lie within the viewport; nonfinite/empty bounds, document scrolling or
post-capture button/label/viewport changes fail. Existing opacity, opaque PNG,
text-fill-only masking, one-pixel label margin and minimum 4.5 checks remain.

Only this test helper and this checkpoint change. All production code, styles,
fixtures and approved baselines remain exact. Nine existing pixel probes still
pass, and the actual helper is exercised against all six recorded browser/size
rectangles: valid clips pass, low-contrast pixels fail, and wrong DPR or even a
one-pixel dimension mismatch is rejected. These are source-only probes, not a
new browser pass. Source syntax and test-definition AST equality also pass.
No build, typecheck or whole suite is repeated for unchanged product inputs.

Next: run only the 1280px dark Home case in Chromium and mobile-WebKit. These two
native cases directly cover fractional-origin enclosure and DPR3 CSS-pixel
capture. Preserve the other exact-input acceptance evidence, and do not claim
this final boundary resolved until both cases pass without a retry-only result.
