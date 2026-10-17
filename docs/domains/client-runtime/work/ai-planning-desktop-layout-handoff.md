# AI planning desktop layout

Status: local candidate, native acceptance pending

## Ownership and scope

- Branch: `fix/ai-planning-desktop-layout`.
- Base: `32285dfe26f57bbb55a718083794f7149faac891`, tree `778d03be2a2e97420e8d6900ea3e4d5385fabb2c`, the exact local tree of PR729 correction 1. Public main was `219019ab` at the ownership check.
- User request: desktop AI proposals should use the available screen width. This work owns presentation only; shared Home chrome belongs to the parallel Home layout work.
- External PR704 owns preview component identity/motion. No TSX, planning/conversation logic, motion, history, focus or save semantics are changed here.

## Evidence and alternatives

The prior PR729 Chromium artifact contains an actual 1280×720 empty-conversation capture: the chat is about 1012px wide while the starter list is about 430px. It is not a populated-proposal capture. Current CSS separately caps the proposal card at 620px and the preview dialog at 508px, with no desktop widening rule. The older 508px outer AI-view rule is overridden by the primary surface stylesheet and is not the live outer-width cause.

Options considered:

1. Increase the fixed caps. This is small, but another fixed width would continue wasting larger desktop space; a fluid viewport comparison would falsify its adequacy.
2. Add desktop-only, parent-relative card/starter widths and a viewport-relative preview, preserving the existing scroll/flex owners. This directly targets the observed/source-backed constraints with a narrow CSS boundary. Native fixture geometry and screenshots must still verify the actual cascade and controls.
3. Rebuild the page as persistent multi-pane UI. This could use more width, but adds component/history/focus ownership changes overlapping PR704 and is unnecessary for this complaint.

Option 2 is selected. Conversation message/prose widths stay unchanged. There is no claim that the large-screen proposal has been visually verified.

## Candidate behavior

- At widths of at least 1100px, starters and the proposal card fill the existing conversation width; the three starter choices share one row. The 1024px tablet and all narrower rules are unchanged.
- The separate preview overlay uses the viewport with a 24px gutter. Its existing flex/scroll owners, close/motion behavior and full 24-hour overview remain unchanged.
- Ordinary controls, week dates and detail titles gain a 14px-at-default-root floor; supporting text uses 12px. The hint and detail title retain 80ch/70ch reading limits, and chat prose widths remain unchanged.
- Compact overview event labels retain their existing small typography. Increasing both lines inside percentage-height short events could clip or overlap events. This candidate does not claim to solve every calendar-label readability issue; the existing keyboard-reachable day-detail view remains the readable detail route.

## Verification checkpoint

- Focused CSS contract reproduced the missing desktop rules (2 failed, 1 passed) before the CSS change. Final four-file related check passes 14 tests: desktop styles, preview period paging, retained planning view and chat sidebar visibility.
- Production build passes. Both desktop rule groups are present in the emitted CSS; this checks delivery, not computed styles or pixels.
- Native definition collection for `ai-planning-surface`, `ai-planning-composer-viewport` and `ai-planning-preview-viewport-lock` retains all 18 existing identities and adds six, without duplicates. This is collection, not test execution.
- The six new existing-fixture cases cover empty choices and a populated 12-item proposal with long conversation history at 1280×720, 1440×900 and 1920×1080. They attach geometry, viewport, DPR, workflow revision and screenshots; check visible primary controls, keyboard access to day detail, separate scroll ownership and retained unsent draft/history. Existing mobile keyboard/paging/viewport-lock definitions are preserved.
- The CSS outside the two new desktop media blocks is byte-preserved. Component, conversation, preview motion, shared Home shell and existing keyboard/viewport-lock specs are unchanged.
- Native browser execution is currently unavailable through the permitted local route. A separate cloud browser is signed out and viewport emulation was blocked; neither is bypassed.
- Independent exact-diff review found no source-level blocker on the two CSS overrides, six fixture cases, delivery order and preserved boundaries. The reviewed staged tree is `12085c5bc0fe8da0366543a6ea7158452ee5eb77`; the only subsequent change is this checkpoint paragraph.
- Native limits remain: the six cases use ordinary one-hour events at default text size/light theme. They do not establish dense/short-event rendering, 200% text containment or dark-theme rendering. Compact overview typography is still limited as described above.
- Next: normal approved CI screenshots at all three desktop viewports. Publication and CI dispatch are outside this local task.
- Completion for this local candidate: exact reviewed CSS/test diff, related contract checks, definition identity preservation and explicit pending rendered acceptance. No claim of production acceptance before the native captures pass and are inspected.


## Combined local continuation

This reviewed candidate is now composed with Home on the exact correction-4
runtime in the [desktop Home integration checkpoint](desktop-home-viewport-handoff.md#combined-home--ai-checkpoint-2026-10-17).
The two production CSS files remain byte-identical to `cd7444fc`. The six original
light desktop cases retain their identities, now assert the resolved theme, and
have six dark counterparts. That extends the definitions; dark rendering is
still unverified. The combined checkpoint owns current checks, base, next action
and publication limits, rather than replacing the original evidence above.

## PR737 rendered dark-preview correction

The pinned four-surface native run39043107215 verified all15 AI surface cases geometrically on source fb018e4d/tree638cc9aa. Independent image review nevertheless found unreadable pale headings/date labels on white preview panels in all three dark desktop sizes. Geometry success is not readability acceptance.

The v2 preview is a sibling of the legacy `.ai-planning-view`; existing ancestor-scoped dark rules therefore miss it. That structure and the hardcoded white surfaces already exist on the release base. The correction adds dark-only component-local surface/text/border token pairs. The same paired dark tokens repair the proposal-card preview action and count badge, whose white-on-accent text was also confirmed by image review. Light styling, geometry, event tones, motion, conversation and persistence stay unchanged.

Related source checks pass17 tests across preview theme, desktop presentation and period paging. The ordinary Vite configuration cannot enumerate network interfaces in this restricted executor; an equivalent Node-only source-test config was used for these pure CSS/period tests. This is not an app-build or browser result. The integration owner performs one combined app type/build check.

Native definitions retain all15 existing AI surface identities and add one390px dark preview guard. The three existing dark desktop proposal cases now attach contrast samples before asserting4.5:1 for the specified overview/detail labels and actions; a white backing conservatively bounds translucent dark surfaces. This checks those labels, not a whole-page WCAG audit. New source rendering and contrast results remain pending the bounded CI follow-up.
