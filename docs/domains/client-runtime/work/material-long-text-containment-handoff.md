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
