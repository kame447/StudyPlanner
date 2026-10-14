# Day grid native selection

Status: PR #648 is published; WebKit test-contract correction passed local verification, native rerun and merge pending

- Owner: `implement_day_schedule_actions`, coordinated by the release owner.
- Branch: `fix/day-grid-native-selection`; base/initial HEAD `90211bdcf39dd9bce66211df129949a5668a0de4`.
- User reference `IMG_2462.png` was viewed on the working server. The Day time grid is covered by a blue native selection region with Safari selection handles; this is distinct from the app's individual selected-plan styling or moving-card overlay.
- Current Issue #483 comments, open/closed related PRs and branch names were inspected before implementation. No active implementation of this scope was found. Existing PR #541 owns time editing/cancellation and its independent font-size CI repair; this request must not change that branch. No new Issue or PR has been created.

## Boundary and smallest correction

The existing drag-button CSS already disables text selection and WebKit callouts, but the surrounding Day-only `.timeline-shell` and projected, non-draggable timetable cards do not. Scope the same native-selection policy to that grid only, with explicit text-input/textarea/contenteditable exceptions. Keep pointer/touch handlers, `touch-action`, scrolling, native button semantics and application long-press movement unchanged.

A document-wide selection or context-menu cancellation would also affect editors and other pages. Clearing selection after every change would fight user input and accessibility. Neither is needed for this local presentation boundary.

## Exact verification checkpoint — 2026-10-14

- Production diff is ten CSS lines, scoped to the Day grid and editable descendants. No event handler, application state, touch-action, pointer-events, accessibility semantics, persistence, or shared runner/configuration changed.
- Scoped CSS contract was red before the fix (2 failures, 1 pass) and green afterward. Focused validation passed 4 files / 36 tests, including the existing Day event drag, occurrence activation and timeline controller cases for long-press, scroll, multiple touches and cleanup.
- Existing Day visibility browser specification now covers native mouse selection suppression, editable CSS exceptions and real touch/click plus keyboard activation at 390px and 1280px. Existing saved-timetable drag/Undo coverage is retained. The temporary controls in this test check the CSS exception, not a new app editor.
- Syntax checking passed. Browser-free WebKit collection found 7 cases (2 added, 5 existing). Local native browser launch is already blocked by socket EPERM and was not retried. Browser collection is not execution; physical Safari selection handles remain a separate unverified device boundary.
- Final command: `DEV_LAN_HOST=127.0.0.1 CLOUDFLARE_CF_FETCH_ENABLED=false WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 npm run verify`; exit 0. Fresh nonincremental app/Worker typechecks, 886 passing test files / 8461 passing tests (54 skipped, 1 todo), and production build passed. No lint script is configured. Optional Wrangler debug-log writing reported ENOENT; fresh Worker type generation and verification still succeeded. Existing chunk-size warning is retained.
- Exact source inputs before/after are identical: 2206 non-Markdown files, SHA-256 `f021f372453bb096b296d18f99bf26078b95b57010f9627f3fac256e14ddf32e`. Generated test `.cache/` files are excluded and not committed. Only this documentation is updated after verification.
- Installed dependencies before/after are identical: 19328 files, SHA-256 `853d115f3fa57c7d701198ef36e5309559c6046213d6a86a03946ab49b4c6a4f`, excluding disposable bundler caches, compiler build-info and npm's installation metadata. Installed versions agree with the lockfile: Node 24.19.0, TypeScript 5.9.3, Vite 6.4.3, Vitest 3.2.7, Wrangler 4.147.0 and React 18.3.1.
- Fresh generated Worker types: SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`. The full input/output fingerprints, command/environment, red/focused/full logs and commit receipt are retained by the release coordinator.
- Independent review of the exact CSS/test diff found no blocking issue. These results do not establish native browser or physical iOS behavior.

## Next action and exit boundary

Keep this independent branch separate from PR #541 and the previously approved four-feature release. After separate publication approval, use existing Chromium and WebKit CI with the unchanged runners and inspect native results. A physical iOS check is still required to directly establish system callout suppression. Do not weaken native assertions or claim full UI completion from local unit/build proof.

The user approved publication and main integration after browser verification on 2026-10-14. The release owner is the sole publisher. PR [#648](https://github.com/kame447/StudyPlanner/pull/648), remote `76b434cc5616bbe4141743eb4224de8bf9e59a84`, has the same tree `7272b927475944def55d036bbfce8889a5b654da` as local `8703052e1e89cca175474ce5fd6c459e33458b15`. CI merge checkout `9b303a096055d1c7df32b47a473351296b45f5e3` is also identical. No production service activation is included.

## WebKit native checkpoint and test-contract repair

- Initial exact-tree CI [38553798328](https://github.com/kame447/StudyPlanner/actions/runs/38553798328) passed fresh types, 8461 tests, Rules and build. Chromium [38553798360](https://github.com/kame447/StudyPlanner/actions/runs/38553798360) passed all 687 cases, including both new selection cases and saved-card drag/Undo/Redo. Admin, desktop Chromium/Firefox/WebKit, visual and browser-quality checks passed. Bundle budget retains the existing six metric overruns; thresholds are unchanged.
- Mobile WebKit [38553798505](https://github.com/kame447/StudyPlanner/actions/runs/38553798505), job `115817833366`, passed 278 and failed the two new selection cases, with 3 existing skips. Both widths and both attempts fail at the computed-value assertion before any actual selection gesture. Existing saved-card drag/Undo/Redo passes. Merge remains blocked.
- Full native artifact `11889847825` was downloaded through the connector, byte count 101636082 and SHA-256 `1cb52cb04d6bbaac6e0c81d21742efb625b9cbf3fb20742d49dbd88a24c062a9` verified. Failure image and trace were inspected. The trace retains the failing assertion and rendered page but does not record the locator-evaluation result, so the exact descendant computed values are not claimed as observed.
- The previous assertion incorrectly equated computed and used values for every descendant. [CSS UI Level 4](https://www.w3.org/TR/css-ui-4/#propdef-user-select) makes `user-select` non-inherited, with a child computed `auto` resolving to used `none` under a non-selectable parent. WebKit's [implementation change #239514](https://bugs.webkit.org/show_bug.cgi?id=239514) and its own [test correction #321698](https://bugs.webkit.org/show_bug.cgi?id=321698) document this distinction. The test contract needs correction independently of whether an additional product defect exists; the next native run must establish actual behavior.
- The repair leaves production CSS and gestures unchanged. Require the grid's explicit `none`, accept spec-valid descendant computed `auto`, and exercise actual title → time → kind selection gestures while the mouse is held, before a detail dialog can alter focus. Begin the existing saved-card drag on its title and require empty text selection before mouse release, while retaining exact moved times, Undo, Redo and reload assertions.
- Log actual per-node policy for diagnosis. Check callout style only when `CSS.supports` exposes the property, and annotate unsupported browser ports as an unverified physical-iOS boundary, not success. Unit coverage still requires the production declarations and editor exceptions. Do not expand CSS to every descendant solely to satisfy a computed-style assertion.
- The user's additional image of native selection inside a timetable card was viewed locally. Its title, time and kind are normal text descendants within this same Day grid. Private image contents are not copied to repository artifacts; all native tests use the existing fictional fixtures.

- Corrected test snapshot passed focused 4 files / 36 tests, syntax checking and 7-case WebKit collection. Final local `verify` (same command/environment above) exited 0: fresh app/Worker checks, 886 files / 8461 tests, 54 skips / 1 todo, build 5.33s. Before/after source SHA-256 `204620b6a019d7257dc0beb0f1c38239b6431399c09a0188f496f19d40ed29e1`, installed-dependency hash and generated Worker types match. No production code changed. This local success does not resolve the native failure until the corrected cases run there.

Next: sole-owner publication to the same PR and exact-head Chromium/WebKit reruns. The real gesture checks must pass; a repeated failure returns to diagnosis rather than relaxing assertions. Physical iOS system selection handles remain separately unverified.


## Current-main integration

Day controls PR #541 merged to main `8565cbbc5b05674ce342afa29ac2324a65687e8c`. That main was merged normally into the same selection branch before publishing the native-test repair, so the next CI checks the real combined content. Keep both scheduling README links and the now-available Day deletion action assertion. The only textual conflict was the README's adjacent work links; the selection cases and saved-card drag assertions merged cleanly. Production selection CSS is unchanged. The combined final `verify` passed with fresh nonincremental app/Worker checks, 891 files / 8526 tests (54 skipped, 1 todo), and build 5.18s; exit 0. Before/after source SHA-256 `ac5b9be988617c0d162dac3300f08e8c5424e33f21ee3ff5c58e761230bdf8f2` (2216 source files) and the installed-dependency/Worker-type hashes above are identical. It ran after the other integration verification ended, not concurrently. Only the checkpoint changed afterward. Publish this integrated snapshot to existing PR #648; native reruns and physical iOS boundaries remain as above.
