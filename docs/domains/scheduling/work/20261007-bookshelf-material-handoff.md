# Bookshelf material handoff

Status: active; dependent draft PR preparation and exact-head browser verification

## Ownership and scope

- Owner: current maintenance task, branch `fix/bookshelf-material-handoff`.
- Original reproduction base: `bdaf3c036284233f29e3f7af0b2df02852378c4e`. Current main is `402d6325fdb52c5cb4fa739442459eb7d7d5040d`; publication is based on the reviewed Home/settings dependency, PR #523.
- Existing work checked: merged PR #162 introduced the generic Quick Entry callback; open PR #517 changes the hidden MaterialQuickCreateModal validation and does not repair the active bookshelf path. Open/closed Issues, current PRs, and local/remote branches showed no active handoff repair owner.
- Existing audit Issue #382 is the tracking context. PR #517 addresses a different hidden modal; no overlapping Bookshelf handoff PR was found. The current branch is reused for authorized draft publication. No other worktree was edited.
- Scope: preserve the explicitly selected bookshelf material into the current Quick Entry scheduled-plan flow; retain the generic Todo default. No hidden Day import changes.

## Implemented behavior

- App captures the material ID with an owner and fresh editor-session identity. Quick Entry resolves its initial title and subject from the current owner's active materials and treats the material as an explicit selection.
- Both material detail and material menu actions start a scheduled plan. Changing the title does not infer away the selected material.
- Close/reopen creates a fresh editor; old close or save completion cannot dismiss a newer editor. Owner replacement hides and retires the previous context.
- Deletion/archive of a selected material blocks scheduled-plan and Actual saves rather than silently dropping the link. The draft remains visible; the user may choose another material or explicitly choose no material. The selector remains available when the last material disappears.
- Generic schedule Quick Entry still starts with a blank Todo. Intentionally switching to Todo retains its existing separate lifecycle and does not create a material-linked scheduled event.

The alternatives considered were passing a captured material object (stale metadata risk), passing an owner-bound material ID resolved against current materials (implemented), or reviving the hidden legacy modal (unnecessary duplicate surface and wrong initial entry mode).

## Verified evidence — 2026-10-07 UTC

- Baseline `bdaf3c03`: the real App/Bookshelf/QuickEntry regression failed because material A opened with an empty title. The production callback discarded the material argument.
- New real App + Bookshelf + QuickEntry + planner hook + canonical local repository regressions: 9 passed. Covers detail/menu save and fresh-repository reload IDs, explicit choice surviving title edits, generic Todo, close/reopen, stale close, saveable stale owner callback, deletion/archive, last-material recovery, and delayed same-owner/old-owner saves.
- Focused suite including existing Quick Entry lifetime and App recovery tests: 20/20 passed.
- Independent review: no remaining blocker found; separate handoff/lifetime run passed 15/15; exact diff check clean.
- Final stable-state `DEV_LAN_HOST=127.0.0.1 VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 npm run verify`: exit 0; full app and worker type checks passed; 736 test files passed / 10 skipped; 5,831 tests passed / 45 skipped / 1 todo; production build passed. Existing Vite chunk-size warning remains. No lint command is configured.
- Added full-App browser scenarios for desktop and mobile. Syntax checking and Playwright test discovery passed (2 tests). Assertions inspect canonical `studyplanner.scheduleEvents.v1`, then verify the material's schedule after page reload; legacy `studyplanner.plans` is only a migration seed.
- Browser execution was not performed: the current environment's browser Unix-socket capability is blocked. An unchanged launch attempt was not repeated. These scenarios are not yet a browser pass or visual/responsive verification.

Original isolated-base verified runtime/test SHA-256 values (historical; App changes again when integrating the Home dependency):

- `src/App.tsx`: `a9e0060b3279ff92d74c4908d99ada43f4fb39c1a64dfbffbaaabf8ee72fa05f`
- `src/components/QuickEntryModal.tsx`: `5539fde160e45ab9aa1e4709215eb3293679666993b91d677c9c2c1e83d514c5`
- `src/App.bookshelfMaterialHandoff.test.tsx`: `1008647fdaabef235aebad77573d2962086178741a00d1d99fdfe37e6d2e6c2a`
- `tests/e2e/bookshelf-material-handoff.spec.mjs`: `2bd54f9a5110bae58228aa948e7ce5db9c514b5797b869b9a4e21aea8f1d70e5`

## Bundle budget and dependency evidence

The final production build was checked with the unchanged `scripts/ci/check-bundle-budget.mjs`. It exited 1 only for JavaScript total raw size: **2,200,261 bytes vs 2,200,000 bytes (261 bytes over)**. Rounded KiB output must not be used to calculate the exact overage. No cap was increased on this branch.

Other measured values passed:

- JavaScript total gzip: 590,132 bytes; largest raw: 727,944 bytes; largest gzip: 205,603 bytes.
- CSS total raw: 469,761 bytes; total gzip: 78,190 bytes; largest raw: 409,233 bytes; largest gzip: 65,525 bytes.

The complete current Home/settings + timetable import + bookshelf integration must be remeasured against its already justified budget; this isolated old-base result is not an integration budget pass. Machine report: `artifacts/quality-gate/bundle-budget.json` (local build artifact, not source).

Dependencies were reused through the existing Home worktree installation; no package or lockfile was changed. Installed versions: TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, Wrangler 4.143.1, React 18.3.1, Firebase 12.12.0.

SHA-256 dependency evidence:

- `package.json`: `3d7fbfe21dc41203eb06fcbe65a516952eff70142f5a284346288107d59dc922`
- `package-lock.json`: `9798272985b44196122e7335b3ea8f18b9b7ffc8aa79047264008b7ce59198bf`
- installed `node_modules/.package-lock.json`: `593797f473dce774cc442224b802d76e641d1bf118f183785e45ef21e8667eb1`
- installed TypeScript package manifest: `822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6`
- installed Vitest package manifest: `3f3dc1ef7acc6ffac8d0a7f10c4460f98e36026837b57f774426d962d546d740`
- installed Vite package manifest: `a1d0149fd986fd34b6d35503d2c0d8d9f743c4dbaaf94fbc11812bc84b05884d`
- installed Wrangler package manifest: `01e5f9f88cf1cb2f6c847f585dc16c3bdafa374276765678c56fd5a0637e44dc`
- installed Playwright test package manifest: `be51f784a5742a1aa075e0173f5f04f189a791cc30c40e3bb18be584f696764e`
- installed Playwright package manifest: `ca170ec143a88ed3043ac953eb3b2377b2b97304104f4e1e23316684ce2c35af`
- installed Playwright core package manifest: `07c47543631fef9508760365dee9fbe958c562093ec8d122543949ed231f233f`

## Dependent PR preparation

Publication of the work branch and a draft PR was authorized on 2026-10-07. No merge, main-branch write, force push, or Ready-for-review transition is authorized.

The draft targets `main` to preserve the existing CI trigger rules and explicitly depends on PR #523. Its initial diff therefore includes the separately reviewed Home/settings changes; final review waits until #523 lands and the comparison shrinks to the Bookshelf-only six-file delta. The independent timetable-import repair (#519, local commit `2570f5c3`) and the combined verification tree are excluded.

The first dependency integration uses Home remote `df414c5f2de4de6fd1fe302de7c30f6d1e0f5412` (tree `1883ebb1e54713a99a98cd03d0c37d356f989545`). The only production conflict was additive App state: retain Home settings navigation and the new owner-bound Quick Entry context. Focused post-integration tests passed 21/21. The stable Home browser-test correction `c61e1ce5df1f0a7a4f9e007a9d2c72ebe2259faf` (tree `635f4530028bfd8061f1e6808a222f14267ba968`) is now integrated. Its only changes from `df414c5f` are two E2E measurement/readiness specs; production behavior and all budgets are unchanged. This is the publication dependency base.

Fresh full app/Worker type checks passed after the additive merge. The full local test/build run is continuing in parallel with draft publication; final status will be recorded against the published head in the PR/audit checkpoint. The focused delta against `c61e1ce5` contains exactly the six Bookshelf source/test/document paths, with no workflow or budget modification and no #519 changes.

Publication source SHA-256 values:

- `src/App.tsx`: `9aa51d4950a59d28898c7fb8b775034495ccfed752f03867e523a28081d5f12e`
- `src/components/QuickEntryModal.tsx`: `5539fde160e45ab9aa1e4709215eb3293679666993b91d677c9c2c1e83d514c5`
- `src/App.bookshelfMaterialHandoff.test.tsx`: `1008647fdaabef235aebad77573d2962086178741a00d1d99fdfe37e6d2e6c2a`
- `tests/e2e/bookshelf-material-handoff.spec.mjs`: `5175813e4bf2efbf0df84b80456f1445720d21ae78c268ab78553474628043e2`

## Next action and exit criteria

Complete fresh verification of the focused Bookshelf + Home dependency tree, measure the unchanged Home budget, publish the branch and draft PR, and follow exact-head CI/browser checks to terminal. The two Bookshelf full-App browser cases attach desktop/mobile screenshots of prefilled material context and the saved/reloaded material schedule.

Keep this branch and PR draft while the #523 dependency remains pending. No branch deletion is performed. Completion of this review/verification task requires terminal exact-head CI and real-browser evidence; merge and main/post-release work remain outside the current authorization.
