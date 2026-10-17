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
