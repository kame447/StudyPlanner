# Day grid native selection

Status: local implementation and full verification complete; native verification and publication pending

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

No upstream push, main write, merge, production service activation or browser-run retry is included in this local work. Exit requires preserved editor/gesture semantics, exact local proof and explicit remaining native/publication limits.
