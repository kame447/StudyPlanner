# Material long-text containment and desktop reachability

Status: local source candidate; new native rendering is unverified. Publication is not approved.

## Finding and boundary

The accepted material creation frame remains **720px / 92dvh**. Prior 1280px
screenshots showed that frame working; they did not cover 1440px, 1920px,
short desktop windows or long unbroken text. This work does not change its size.

Detail titles, subjects, current chapter text, activity notes/plan titles and
the contents editor's material name accept complete user values. Their clipped
parent panels had no unbroken-word wrapping rule. A 260-character ASCII token
in the actual bundled DotGothic16 font has a 2704px advance at the existing
20.8px heading size, or 5408px at 200% root text. Even the entire 1920px viewport
is narrower. This is source/font arithmetic, not a new rendered measurement.

Alternatives considered:

- Resize the creation/modal frame: conflicts with the adopted frame and does
  not address a detail page's unbroken text.
- Assume an inherited wrap rule or truncate the value: the inspected cascade
  has no applicable rule; truncation would remove the requested full text.
- Allow wrapping on those five text targets: selected. One grouped declaration
  retains the complete text and lets existing page/editor scrolling own height.

The new declaration applies at all widths. Deliberately compact contents-row
ellipsis stays unchanged; the full title remains editable. Inputs, shared modal
styles, typography sizes, motion, storage and auth code are unchanged.
PR706 remains the separate cover-motion owner; its detail delta adds only two
cover attributes and does not overlap this CSS rule.

## Exact local scope

- Branch `fix/material-long-text-containment`.
- Base `628e3df6839d92668d3de727ed3239ef5df0f827`, tree
  `ee6e0ec5156df5a5838a24c9af0bddb6d30920d3`, equal to official main
  `8261300b3f681150127c726169708efd93a4a68a` at the ownership check.
  The local parent is the source commit, not the later merge commit.
- Existing UI umbrella #483 is reused conceptually; no remote issue, branch or
  PR was created. The earlier materials inspection had no implementation branch.
- Product delta: nine CSS lines, one declaration on five explicit text targets.
- New native definitions are appended to the two existing bookshelf specs;
  every original byte and test identity is retained. No shared fixture/config
  changes, timeout changes or old assertion removals.

## Relevant verification

- Source regression on unchanged CSS: five missing-wrap failures, one retained
  editor/ellipsis contract pass. The first draft also had an incorrect selector
  in the unchanged-contract assertion; that test typo was corrected before the
  final red proof. Both logs are retained.
- Three related files / **13 source/component tests passed**.
- Fresh application TypeScript check passed; production build passed in 5.24s.
  Exactly one emitted grouped wrapping rule is verified in the built CSS.
- Installed Node/Vite/TypeScript/Vitest/Playwright identities and the successful
  physical npm inventory are bound in the evidence receipt. No dependency install.
- Native collection only: standard Chromium **29 → 36**, cross-project
  **44 → 54**, no missing or duplicate original identities. The cross definition
  set contains creation in desktop/mobile WebKit and detail in mobile WebKit;
  it is not a desktop Firefox or desktop WebKit detail execution claim.

New acceptance definitions cover creation at 1440×900, 1920×1080, 1280×600 and
long detail/editor text at those sizes plus 390×844. Each exercises 100%/200%
root text. Creation checks the unchanged frame, stationary footer, all expanded
fields and saved/reloaded name. Detail uses the loaded pixel font, full expected
values, horizontal text-fragment bounds, scrolling to controls, 24 contents rows,
keyboard save/cancel and persisted reopen/reload. Screenshots and geometry are
attached before containment assertions. The detail test allows vertical scrolling;
it does not claim all long content fits on one screen.

Root-text enlargement is not browser zoom. Fixed-pixel editor inputs can remain
16px; their actual font size and reachability are recorded rather than claimed
to double. The new cases use light theme. Raster ink, all dark/custom themes,
actual virtual keyboards and browser-specific timing remain outside new proof.

## Next gate

The new seven logical cases have **not run in a browser**. No after-image or
visual-fix claim is made. Authorized native execution must confirm wrapping and
control reachability, with the existing compact cases still admitted. If it
fails, diagnose product/cascade versus fixture/measurement before changing a
contract. Independent source/definition review is requested before any publication.

Evidence: `laplans-material-long-text-evidence-20261017` contains the exact patch,
red/green logs, font arithmetic, collection identities, emitted rule, toolchain
and protected-input hashes. No new material asset was generated or replaced.

## First native run and fixture correction — 2026-10-17

The approved bounded run `39057872767` checked application `d8ad9133`
(tree `03ff4c04`) through QA workflow `98a8a46f`. Standard Chromium completed
78 of 82 selected cases successfully. The four new long-detail cases all
stopped at the same expected-text assertion in the upcoming-plan tab: the old
fixture title was displayed instead of the intended long token. Their 200%
and editor Save/reload paths were not reached and remain unverified.

The fixture first opens the application, which migrates legacy plans into
the canonical schedule-event collection. Its subsequent long-text mutation
updated only the legacy plan. The actual repository correctly continued to
project the already-migrated record. This is a fixture-authority mismatch,
not evidence of a failed text-wrapping rule.

The correction updates the same owned, legacy-ID-matched canonical event's
title and plan subject/material name alongside the existing fixture changes.
It throws if that expected migrated plan is missing. No runtime code, CSS,
shared fixture, assertion, timeout, viewport, screenshot or test identity is
changed. The retained 720px/92dvh frame contract is unchanged.

A small source-level check executes the actual seed/mutation callbacks
extracted from this spec against the real local planner repository. The old
callback reproduced the stale title (one failure, two intentionally unselected
checks). The corrected callback passed all three checks: long text survives
fresh repository projection, unrelated records and the migration receipt are
preserved, and a missing owned target fails explicitly. These checks do not
replace native rendering. Evidence is in
`laplans-material-authority-fixture-evidence-20261017`.

Next: run the four corrected long-detail definitions in their existing
Chromium and mobile-WebKit projects, then inspect complete 100%/200% geometry,
editor actions and reload results. Earlier passes remain separately bound to
their execution source; this correction does not create a blanket new pass.

## Separate coarse-pointer text-size correction

The first cross-project run also had three mobile-WebKit creation-sheet
failures, distinct from the four mobile detail fixture failures. At all three
wide/short viewports, root text was 32px but input text remained 16px. Actual
images show enlarged labels/actions beside unchanged input/select text.
The global input-focus rule applies on narrow viewports or a coarse pointer
and fixes text controls to `16px !important`, overriding this sheet's `1rem`.
This is a pre-existing enlargement constraint exposed by the new acceptance,
not a font-loading failure or wrong viewport measurement.

The correction is limited to text-capable inputs and selects in the material
creation dialog's fields under that same media condition. It uses
`max(1rem, 16px) !important`: normal/reduced root text keeps the focus-zoom
floor; enlarged root text can reach 32px. The input selector repeats the global
six type exclusions and adds the local dialog/field prefix, so its specificity
actually wins. Checkbox, radio, range, color, file and hidden inputs are not
changed. The global policy, other editors, frame, interaction and all existing
native assertions remain unchanged.

One new source regression failed on the old rule, then eleven related style
checks passed. The exact CSS assertion checks matching exclusions, local scope,
media, importance and the floor/enlargement formula. This does not prove browser
rendering. QA maps both narrow standard and coarse-pointer creation consumers,
plus the eight corrected long-detail project cases, for bounded reacceptance.
Timer runtime/native inputs and previous timer image evidence are unaffected.

## Detail reachability measurement and independent scale scenarios

The correction run `39059512430` used application `cf4512af` / tree
`1b43714e`. All six selected creation cases passed on their first attempt,
including the three wide mobile-WebKit cases with input text enlarged to
32px. The eight detail cases passed the previously failing 100% activity-title
expectation, then stopped at a later reachability assertion or cumulative timeout.
They are not accepted yet.

The reachability helper treated every overflow ancestor as an ordinary box.
For the document root it combined a scroll-shifted bounding rectangle with
viewport-sized `clientHeight`. This is not the root overflow coordinate
system. A native 390px trace records root scrollTop 454 while the last editor
input is at viewport y385.047–431.047; the old source calculation incorrectly
limits that root clip to y390. The first diagnostics recorded only an empty
class name, so the new diagnostic also records each ancestor's tag, rectangle,
scroll offset and clipping frame. Only the document root uses a zero-origin
viewport frame. Body/editor clipping, viewport bounds, focus and trial-click
assertions are retained.

This follows [root overflow viewport propagation](https://drafts.csswg.org/css-overflow-3/#overflow-propagation)
and [root clientHeight](https://drafts.csswg.org/cssom-view/#dom-element-clientheight).
An extracted actual-callback probe reproduces the old false blocker and checks
the corrected calculation, including negatives for editor, body and viewport
clipping. It is a source-level probe, not new browser rendering.

The 1920px mobile trace completes the 100% editor save, reopen and cancel
sequence. Both attempts exhaust the shared 30-second budget during the later
200% activity-tab interaction. Trace timings show cumulative scrolling and
action-stability waits; screenshots alone do not explain the duration. The
two scales are now separate scenarios with the same timeout, viewport,
pointer actions, fixture and assertions. Each 200% scenario first measures
the actual loaded 100% font, then changes that same document to 200% and keeps
the greater-than-1.9 enlargement check. Both scales now finish with their own
save, reopen, cancel and page reload. The inter-scale restore write is no
longer needed.

The eight prior failed project-qualified identities have sixteen explicit
successors. Earlier clean creation/timer results remain historical input-bound
evidence. No product CSS, component, shared helper, configuration, timeout or
geometry threshold changes in this correction. Next: run those sixteen
successors and inspect the complete detail/editor/scroll/save results before
acceptance. Evidence: `laplans-material-detail-reachability-evidence-20261017`.

## 2026-10-17: remove duplicate action preparation in long-detail acceptance

- Exact preceding source: `0ce2b3c9` / tree `0e6524bf`; run `39060551709`.
  Chromium's eight split-scale cases passed on their first attempt. Mobile had
  four first-attempt passes, one flaky result and three cumulative 30s timeouts.
  All reported root-clipping false positives were resolved; this does not make
  the remaining timeouts acceptable.
- Seven retained failed traces show repeated explicit scroll preparation taking
  roughly 1–5.7s, in addition to the following normal trial-click checks. The
  wide mobile cases also spend time on navigation, tab clicks and editor reopen.
  Explicit PNG capture is only part of the total. Screencast metadata describes
  a DPR3 screen, but the actual encoded JPEG/video is 800px wide, not 5760px.
- Compared options: (1) a product scrolling/rendering defect, which would require
  specific motion/position evidence before changing CSS; (2) recording overhead,
  which needs a controlled comparison and is not established by image metadata;
  (3) duplicate test preparation. Choose (3) as the narrowest independently
  inspectable correction. A fresh native failure would falsify the claim that
  this change is sufficient; no speed or product-performance guarantee is made.
- The helper now focuses the real control and performs the same unforced trial
  click before measuring its final position. Playwright still checks stability,
  visibility, enabled state, scrolling and pointer hit-target reachability.
  All viewport, overflow-ancestor and focused-control assertions remain intact.
  Failed actions still attempt diagnostic attachment and rethrow the original
  failure, including when diagnostic capture itself fails.
- Product bytes, fixtures, test definitions, DPR, viewport, font, 30s timeout,
  retries, trace, video and explicit screenshots are unchanged. The change does
  not claim that a complete visible frame or actual pointer activation occurred
  where the test only used a trial click; Save/Cancel still use real Enter input.
- Local evidence: syntax/diff checks; nine source-extracted async sequencing and
  rejection probes; exact geometry callback/assertion and case-body comparison;
  1,768 runtime/support/build input hashes unchanged. The probe's initial empty
  cross-VM array comparison was corrected in the probe matcher only. A separate
  boundary script had an unused lambda syntax error and trailing-newline slice
  mismatch; both were corrected without changing the candidate assertions.
- Evidence: `/workspace/shared/laplans-material-control-actionability-evidence-20261017/`.
  New native execution remains required. No new application build is warranted
  by this test-only helper change; previous product build evidence remains tied
  to its recorded inputs. The editor's existing fixed input-text size at 200%
  remains a separate limitation, not an all-input text-resizing acceptance.

## Latest-main composition for the timer/material release

The release candidate `70a90774` was combined without conflicts with official
main `237500d9` (previous main `a39defd8`). The 24 external paths from #717/#718
are preserved exactly: planning reply-reference code/tests and its Worker
connection, plus five repository skill/document files. No external path was
rewritten to resolve this composition. Timer/material product, fixture, native
specification, font, shared modal/input style, bootstrap and Playwright settings
remain identical to the candidate.

The old 1,974-input native manifest is not wholly identical: eight existing
weekly-planning source/test inputs changed and five new source/test inputs were
added. Shared/Worker changes are also recorded separately. These functions serve
planning turns, and the new reply-reference calibration remains null; the tested
local timer/material journeys do not submit those turns. This is a source-based
consumer boundary, not new native execution on latest main.

Because the application imports changed, one fresh production build was run
with the existing lock and shared installation: pass, Vite 5.93s. A broader
2,101-input build manifest includes shared/Worker inputs, and all ten emitted
CSS assets remain byte-identical to the prior reviewed product build. No native
or typecheck was duplicated for this clean composition. The separate immutable
six-case run still belongs to its recorded `a2037ff1` source. Its result and the
source-bound carryover must be reviewed before publication/merge acceptance.

Evidence: `laplans-timer-material-latest-evidence-20261017`. Next: independent
composition review and the pending material-control native/visual acceptance.
