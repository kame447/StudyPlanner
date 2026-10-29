# Route skeleton loading — Issue #896

Status: draft PR #899 remains open; corrected route tests passed native execution, and current-main integration has fresh local proof. New integrated-head native checks remain pending. No merge authorized.

Current acceptance: corrected-head native evidence covers 144 route-skeleton cases and AI late-navigation; the full Browser Matrix remains failed on separate day-occurrence #853 and startup touch-skip timing evidence. Current-main native execution, assistive-technology and physical-device acceptance remain open. Historical milestones below retain their original scope.

- Branch: `feat/issue896-skeleton-loading`; base `c1a702229491598cb7f244c75824c0b2f598e1ef`.
- Scope fixed after current-code / Issue / PR / all-branch audit: Month, Week, Day, Todo, Bookshelf, Report, Timetable, initial AI route and Contact lazy form only.
- Replace transient logo/icon/text route fallbacks with static, theme-aware layout placeholders. Keep existing shell, errors, owner lifetimes, pending Month add requests, startup video/auth gates, refresh notices, empty states and save/send states.
- Retain existing loading state and preload logic. No new timing manager, data model, API or dependencies.
- Defer Admin/Streak/Announcements, login shift #885, physical-device performance and existing budget/WebKit issues.
- Alternatives considered: globally changing SplashScreen would alter intentional startup/auth; per-caller duplicate markup would duplicate nine presentation contracts; a typed shared presentation-only component keeps runtime state unchanged and is the chosen minimum.
- Verification required: focused render/lazy/failure/owner tests, fresh types/build, final combined verify by integration owner, desktop/mobile light/dark slow-delivery visual/browser checks with accessible status and stable shell. Not yet run.
- Next: implement fixed presentation scope, run focused evidence, independent patch review. No remote push/PR/merge authorized in this lane.

## Local implementation checkpoint (2026-10-29)

- Implemented one typed presentation component and static token-based CSS, five Deferred view fallbacks, Week/Todo outer fallback, initial AI fallback and Contact form fallback. The Month placeholder matches the existing six-row viewport grid; Week also stays within the remaining schedule viewport.
- Focused suites: 15 files / 76 tests passed. The first run failed 10 new expectations due to JSX string/boolean aria props; props were made explicit booleans and all existing lifecycle assertions retained.
- Fresh app/Worker type checks and production build passed (40.72s). Existing npm proxy, Wrangler log-directory and chunk-size warnings remain; this is not a warning-free claim.
- Added 36 browser cases: nine surfaces at 390/1280px × light/dark, reduced motion, accessibility, shell geometry, empty-content delivery, and screenshots. Existing Contact assertions now require the skeleton rather than the retired icon. All new cases are included in the shared cross-browser set. Collection succeeds (52 total with existing Month/Contact/workspace recovery tests); collection is not execution evidence.
- Actual browser execution is blocked before application assertions: managed Chromium download returned truncated ZIPs; installed Chromium 155 cannot create its singleton socket in the sandbox (EPERM). A normal escalated launch probe failed in environment setup with `bwrap: Can't create file at /home/agent/.codex/sessions: Read-only file system`. That path was not read or modified. No repeated escalation or permission bypass. No rendered screenshots or physical-device acceptance claimed.
- Full verify and independent exact-patch review pending. Full verify waits for the integration owner's already-running full suite to finish, avoiding concurrent heavy tests.

## Independent review correction

- The first exact local full verify at `4f94bee2` passed. This is historical pre-correction evidence, not final acceptance.
- Independent review found that a status inside an `aria-busy` ancestor could have its live-region changes deferred. Moved the single status to a sibling outside the busy section, with structural regression assertions. No loading state or lifetime changed; actual assistive-technology speech remains unverified.
- The root cloud-browser check also could not observe the local preview (URL authority/security policy). No public tunnel, network/security change or further denied-path attempt was made. Final corrected full verify is next.

## Final local verification

- Corrected source HEAD `60fbcff73777bb682806c0a8b5997c2edf507075`, tree `c241d052b2b17208a04710f7ba922641929b6b03`.
- `TZ=UTC DEV_LAN_HOST=127.0.0.1 npm run verify` exited 0: fresh application and generated Worker types; 1,114 test files / 12,037 tests passed; 12 files skipped, 15 expected failures, 67 skipped tests and one todo retained; production build 27.29s. Corrected focused 15 files / 76 tests also passed.
- All 3,131 tracked source inputs unchanged across verification. All 19,568 installed non-cache files unchanged, SHA-256 `484c4e9380b09e6f2606cca009d17daf572e34265d088aba6ce391f3d65ff2a5` (sorted JSON path/hash manifest). Node v24.22.1. The 78 changed dependency-directory files are generated `.vite/vitest` results / `.vitest-cache` transforms; one untracked `.cache/j1-worker-fixtures` output is also classified as generated, not source.
- Independent corrected-source review passed the presentation/caller scope, accessibility structure and preserved ownership/error/auth boundaries. It does not certify browser pixels or actual screen-reader speech.
- Browser cases collect as 36 per browser project (144 across the four native cross-browser projects); execution/rendered review remains blocked as described above. Existing native browser/visual gates, device acceptance and final publication/main integration are not complete. No remote push, PR, merge or deployment occurred.
- Next: obtain an authorized browser execution environment/native CI for the existing scoped tests and rendered review before treating #896 as fully accepted. This final checkpoint is documentation only; runtime/test bytes remain those verified at `60fbcff7`.

## Draft publication preparation (2026-10-29 07:00 UTC authorization)

- User authorized a draft PR and GitHub browser testing, not merge. Publication is owned by the release coordinator; the local implementation lane does not push. Keep the PR draft while native acceptance remains open.
- Fresh actual main `f0a3de815550f621a32ae628a105368b5f2f2082` was normally merged into prior skeleton `a550b5bf`. Integration HEAD `397ed00adb321fb27b9ad6a0d8c43a0b865435b3`, tree `eff4ef17bea2338721cc50d3f25bc7ec1b10d12b`. No conflicts or scope expansion: all prior 21 changed paths remain byte-identical, while main's two telemetry files are preserved.
- Fresh integrated `TZ=UTC DEV_LAN_HOST=127.0.0.1 npm run verify` exited 0: fresh app/Worker types; 1,114 files / 12,038 tests passed; the same 15 expected failures, 67 skipped tests and one todo retained; production build 37.14s. Source and non-cache installed-dependency identity were checked before/after.
- Existing Browser Regression and UI Regression Matrix workflows accept `pull_request` events without a draft exclusion. No workflow redesign, security-setting change or premature Ready transition is needed. Their native execution/screenshots remain required; prior local collection is not substituted for browser evidence.

## Native browser contract correction

- Draft #899 head `42b6240239597418455875238c530322d43b3d2d` reached native browser execution. Chromium shard 1 failed twice at `ai-planning-composer-viewport.spec.mjs:418`: the existing test still looked for the retired visible text `AI計画を開いています`.
- Compared three explanations: missing/lost loading surface, stale text selector, and inappropriate visibility assertion for the new screen-reader status. The unedited native failure screenshot shows the AI skeleton, header and selected AI navigation intact; source and raw stack identify the obsolete selector. The later navigation assertions were not reached, so no successful late-delivery behavior is inferred from the screenshot.
- Test-only correction now requires the named skeleton to be visible and busy plus its separate current status, and explicitly requires both to disappear when navigating Home before releasing the module. Existing delayed module arrival, hidden retained AI view, newer Home selection, 24-message restoration and no-splash assertions remain unchanged. No product bytes, timeout, retries or navigation/owner guards changed.
- Fresh local final verification and independent review are required before the same draft is updated; native rerun on the corrected commit remains necessary. The original failed run is retained as failed.


## Complete first-native failure inventory and fixed correction scope

- All initial #899 jobs reached terminal states. Besides the stale AI fallback assertion, Chromium/Firefox/WebKit desktop and the second browser/mobile shards exposed the same 16 new fixture failures: Week/Day/Todo/Report × two widths × two themes. Their route helper entered Bookshelf, where the existing UI intentionally hides the legacy view switcher, then tried unavailable buttons. Actual native DOM contexts confirm the Bookshelf page, not the requested destination.
- The coherent correction uses only public UI entry points: Schedule's labelled tablist for Week/Day/Todo; Home's progress-panel details button for Report. Only Report seeds one owner-scoped plan so its established dashboard entry exists; the other eight surfaces retain empty data. The existing fixed-clock/E2E_TODAY helper keeps the seed date deterministic. All 36 cold-module cases and loading/theme/motion/geometry assertions remain. No runtime flags, hidden-element clicks, timeout changes, skipped cases or production changes are introduced.
- The initial browser second shard and mobile second shard exhausted their existing job budgets after these fixture failures; they remain cancelled, not successful. Mobile first shard also hit the existing #853 day-occurrence timeout, kept separate and untouched.
- AI-only candidate `300f9d13` had 76 focused tests pass, but its full verify was intentionally interrupted with exit 130 when the additional fixture failures arrived. That superseded run is not final proof. Final corrected local verification, independent fixture review and native rerun remain required.

## Coherent correction local proof

- Exact corrected source `179fac8e243fbfbeb3103cb1ab18ed156d12d237`, tree `22724c3ff8400ccc493e3a1efd4f455945a9e312`, passed fresh `TZ=UTC DEV_LAN_HOST=127.0.0.1 npm run verify` (exit 0): app/Worker types; 1,114 files / 12,038 tests passed; 15 expected failures, 67 skipped tests and one todo retained; production build 29.16s. Focused 15 files / 76 tests also passed.
- All 3,131 source inputs and 19,568 non-cache installed dependency files remained unchanged; Node v24.22.1. Independent source, fixture-normalization and documentation reviews passed. The Report seed was checked through the existing plan/event roundtrip; no product code changed.
- The final append is documentation only. Same-draft publication and fresh native execution are next; this local proof does not convert the original browser failures/cancellations or separate #853 timeout into passes. No merge is authorized or performed.

## Current-main integration after corrected native execution

- Published corrected head `e421157e2b2eb8c78a27fe2352d05a06a1f80050` passed all 144 route-skeleton cases across Chromium, Firefox, WebKit desktop/mobile, and the corrected AI late-navigation case. This is scoped browser evidence, not a green full Matrix: mobile first shard failed the separate #853 day-occurrence timeout and recorded startup touch-skip failure on its first attempt (internal retry passed). Neither test nor its timeout was changed. Physical iPhone and assistive-technology acceptance remain unverified.
- Normal merge `07e69cbe4dd0ffafe0f78cb1e1bd3b4eed454d3a` (tree `eff40c18d9f918bf96299049e6eea2aa875a1cb7`) preserves parents `e421157e2b2eb8c78a27fe2352d05a06a1f80050` and current main `a60fc5e8bca2ff745efaf603e939967b3e54e4a9`. Only the seven existing main font files were integrated; their bytes match main, and no skeleton runtime/test source was changed. The PR remains 22 changed paths relative to main, including the corrected existing AI test.
- Fresh integration `TZ=UTC DEV_LAN_HOST=127.0.0.1 npm run verify` exited 0: fresh app/Worker types, 1,114 files / 12,039 tests passed, 15 expected failures, 67 skipped tests and one todo retained, build 32.22s. Focused 15 files / 76 tests passed. Node v24.22.1; all 3,131 tracked inputs and 19,593 installed non-cache files remained unchanged. The 81 changed installed paths were generated `.vitest-cache` entries only; exact before/after manifests retain this distinction.
- This checkpoint update is documentation only. Next: independent exact-tree review, update the same draft with history preserved, then run native checks on the integrated head. Old failed runs are retained; no unchanged-head retry, Ready action or merge is authorized.
