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
