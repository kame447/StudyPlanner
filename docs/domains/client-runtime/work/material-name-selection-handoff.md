# Material name selection order

Status: theme-main focused, fresh types/build and standard/pixel interaction verification passed; not published; public release gates pending
Owner: existing Issue #437; this bounded editor follow-up does not close the umbrella issue.
Branch: `fix/material-name-selection`
Current base: `77fd7085d0f0b1be662cf23589fb9517c557ead5`
Previously verified base: `32623e36f1ebf06058a16f6233514144dee467b3`
Original verified base: `4d86de5f44b6e65309fa1f3f307dad10a4441d96`
PR: none. External Issue, PR, push, main and deployment writes are outside this local task.

## Reproduced behavior

Selecting a catalogue candidate starts asynchronous detail resolution. While it is pending, the user can edit the material name. The delayed success unconditionally sets the catalogue title, losing the newer typed name. Clearing the name is also reversed, restoring save eligibility without a new user action.

The real dialog plus its real search component reproduce four failing cases on unchanged base source: typed replacement, explicit clearing, edit-and-revert, and the saved payload after repeated selection/submit clicks. Five controls pass: ordinary selection, resolution failure, cancellation, and close/reopen with late success/failure.

Already released #493 guards save/delete editor lifetimes; #494 guards cover selection and pending save. Neither owns this later-name-edit precedence. The current open PR/branch inventory has no active material-name owner. Subject, Todo, Home, preferences, startup diagnostics and AI code/tests remain untouched.

## Decision and limits

- Unconditionally applying returned titles reproduces silent loss and is rejected.
- Disabling the name while details resolve prevents the race but unnecessarily removes existing manual-entry behavior during a slow external lookup.
- Capture a name-edit revision when a candidate is selected. Apply its title only if no later manual name edit occurred. Preserve selected catalogue identity, metadata and existing independent cover revision. An explicit later candidate selection may replace the current name normally.

Comparing only name values is insufficient: a user may edit and return to the original name while the lookup is pending. The revision is session-local and does not alter persistence or provider contracts.

## Verification checkpoint

Baseline: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/BookshelfMaterialName.test.tsx --maxWorkers=1 --minWorkers=1`: 4 failed, 5 passed. The local LAN override uses the repository's existing configuration; initial startup without it failed before test collection because the execution environment cannot enumerate network interfaces. Test assertions/configuration are unchanged.

## Historical original-candidate verification — 5ff88b0b, 2026-10-09

The production fix is 11 added and 2 replaced lines in one component. All four initial baseline failures are fixed without changing their assertions. An owner-switch control was added, for ten new cases total.

- Focused: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/BookshelfMaterialName.test.tsx src/components/BookshelfCoverSelection.test.tsx src/components/BookshelfDialogs.test.tsx src/components/BookshelfMaterialSearch.test.tsx src/hooks/usePlannerDataState.materialAdmission.test.tsx --maxWorkers=1 --minWorkers=1`: exit 0, 119 passed / 5 files. Includes 14 existing cover precedence cases and 87 real-hook material admission cases.
- Fresh types: `DEV_LAN_HOST=127.0.0.1 WRANGLER_LOG_PATH=/tmp/material-name-browser/wrangler.log npm run typecheck:full`: exit 0; non-incremental app and Worker checks, newly generated runtime types. The earlier successful run could not write Wrangler's diagnostic log under the environment home; its warning was removed by using the supported writable log path, without altering compiler/runtime inputs.
- Production build: `DEV_LAN_HOST=127.0.0.1 npm run build`: exit 0, 8.63 seconds. Existing dynamic-import/chunk-size notices remain; no build configuration changed.
- Bundle: `node scripts/ci/check-bundle-budget.mjs`: exit 0, all eight existing guards passed. JS raw/gzip 2195.3/590.8 KiB; CSS raw/gzip 473.6/79.6 KiB. No budget changed.
- Real browser: `bookshelf-material-name-order.spec.mjs`, 4 passed, 0 failed/retries, 19.6 seconds. Desktop 1280×844 and mobile-sized 390×844 exercised production App, search/dialog, planner hook and local repository with only metadata service responses controlled. New name survived actual save and reload; empty input stayed empty/save-disabled; explicit reselection applied; old closed-session response did not affect a reopened draft. No live network except loopback was allowed.
- Browser screenshots were recaptured after scrolling the input into view; earlier form-only captures did not visibly establish the name. Final mobile preserved-name and desktop empty-name images were inspected. This is cloud headless Chromium evidence, not an actual iPhone or WebKit claim.
- Read-only independent review found no production-code blocker. Exact diff/check and pending/cancel/owner boundaries were reviewed; this checkpoint records the formerly missing final evidence.

Environment: Node 24.19.0, Vitest 3.2.7, TypeScript from unchanged lockfile, Vite 6.4.3, Wrangler 4.143.1; isolated Playwright 1.62.1 controlling Chrome for Testing 155.0.8059.39. 237 actually installed package identities match the lockfile, with 0 mismatches. The per-worktree dependency link is an execution detail, not a repository/package change.

Verified content before local commit:
- Base HEAD: `4d86de5f44b6e65309fa1f3f307dad10a4441d96`.
- `src/components/BookshelfMaterialDialog.tsx`: SHA-256 `43e9a0748d008110cc8b8eb4cf6cdbbd65f3a5d9c5a84a21e641a116a41a6a18`.
- `src/components/BookshelfMaterialName.test.tsx`: SHA-256 `b9faf91ea8c56565112fd2ca3ad3c3ba9c38a27e973fae9dac2400dd8a706310`.
- `tests/e2e/bookshelf-material-name-order.spec.mjs`: SHA-256 `d7303fadbcc829033fc98036f91290a3373fc925dcf775798ebb8857651b2794`.
- `package-lock.json`: SHA-256 `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`.
- Generated Worker runtime declarations: SHA-256 `bf808b3fb4789a76410fc9c1ba8cd85e80453b8f92fa0981bdb86a9d523d612e`.

## Historical original-candidate handoff

The local unit is ready for integration review. Full-suite integration verification, other browsers, remote CI, PR publication, main merge and deployment have not been performed for this candidate. This worker supplies focused evidence; the integration owner owns those release gates. Keep it separate from the concurrently approved UI recovery release. No real images, production data, live metadata services or AI calls are used. The inherited save/delete lifetime and uncertain-write behaviors are retained, not newly claimed fixed.

No Issue or PR was created or changed. A single local branch was necessary for this newly reproduced logical unit; no existing active material-name branch/PR represented it. No branch was deleted; retain this local branch while review is pending. Existing Issue #437 remains the umbrella tracking destination if publication is later authorized. The patch and verification bundle are saved privately for the parent.

## Current-main integration checkpoint — 2026-10-09 09:56 UTC

Owner: local material-name integration worker; release writer owns publication and final integration/CI gates. Existing local branch is reused; no Issue, remote branch or PR has been created by this worker. Issue #437 remains open for its broader scope. Preflight found no same-scope open PR or remote material-name branch; existing material-related branches own other work.

Recovered candidate `50acf8ac` preserves the original `5ff88b0b` source, then normal merges integrated `5e19b3ed` and `32623e36` without rewriting history. Starting clean HEAD is `5c6816b210fd7659bad0b01770df9598c7a953f7`, tree `315b01bff5d8cf68fb1feb46e4b87780c3179487`. The production diff remains the 13-line name revision guard; metadata identity, cover ordering, TOC, persistence and AI code are unchanged.

Current browser-test edits use initial context viewport/screen dimensions instead of runtime resizing, assert document client width, visual viewport and exact-width media query, and explicitly select these regressions in desktop/mobile WebKit CI. Existing behavior assertions and timeouts remain unchanged.

At this initial source checkpoint, current integration verification had NOT YET RUN. The 119 focused / 4 Chromium results above describe the original candidate. The recovery log describes the intermediate `5e19b3ed` integration only. Neither proves the current main integration. Next: focused material/cover/search/admission tests, fresh app/Worker types, production build/budget, loopback-only Chromium and WebKit synthetic browser cases; then transfer exact final content to the release writer. Full suite, remote CI, merge and deployment remain release-owner responsibilities.

### Current integration evidence — 2026-10-09 10:03 UTC

New execution on the current-main integration (not reused from the original archive): focused 119 passed / 5 files, fresh non-incremental app/Worker types with regenerated runtime declarations, production build, and all existing bundle guards passed. The production source and unit test files still match the original candidate hashes above; dependency identities were independently checked: 237 installed package manifests match the unchanged lockfile, with zero mismatches. No packages were installed or updated.

The first current browser run used initial widths and passed all four Chromium scenarios. WebKit passed five of eight; the other three reached startup/action/overall-time limits. The desktop 390px timeout trace reaches the final saved-and-reloaded payload assertion successfully, but the test is still recorded as failed. The local runner omitted CI's reduced-motion/locale/timezone settings and ran alongside a separate browser validation. A CI-aligned, serialized WebKit run was planned at this checkpoint; its outcome and subsequent diagnosis are recorded below. No assertions, timeouts or production behavior were weakened.

The exact four-project split workflow already published and verified in PR #540 is reused as CI infrastructure only. `.github/workflows/ui-regression.yml` SHA-256 is `0f6e3e0fa36393e75de980398c2f19901ebbc982fe8f24834eccacd4a9821a2f`, identical to published #540 head `f7049f22`. All projects, assertions, retry behavior, 25-minute limits and the existing aggregate `cross-browser-smoke` check are preserved; failed/cancelled/skipped projects cannot satisfy the aggregate. No #540 feature code is included. The release PR must state this provenance and the writer must confirm the duplicate workflow diff disappears after either release reaches main.

### Previous-main local integration result — 32623e36, 2026-10-09 10:17 UTC

Current-main targeted verification is complete. The final test source passed 12/12 browser executions in 180.5 seconds, with zero failed, skipped, flaky or retried tests: four Chromium, four desktop WebKit and four mobile-emulated WebKit cases. Both 390px and 1280px initial contexts verify document client width, visual viewport width and CSS media width, then the actual reduced-motion media query. The original 30-second test limit and all prior behavior assertions are retained. The external-request attempt list is empty in every case.

Behavior verified: a later typed name survives delayed catalogue details and a real local save/reload; explicit clearing remains empty and save-disabled; an explicit newer catalogue selection applies; a closed editor's old response cannot overwrite a reopened draft. The original selection identity and title are saved independently of the manual name. Existing cover-order and real-hook admission tests pass; the production TOC/save paths are unchanged. Final mobile WebKit preserved-name and desktop WebKit empty-name screenshots were inspected.

The first browser run was 9 passed / 3 timed out (Chromium 4/4); the second was WebKit 7 passed / 1 timed out before the material dialog became usable. These are preserved as failed runs, not converted to success. Trace inspection separated two harness issues from the material behavior: every local asset was being routed through `continue`, and Playwright 1.62.1's installed fixtures do not forward unsupported top-level `use.reducedMotion` to the browser context. The trace explicitly showed `reducedMotion: undefined` despite that setting. Serial execution alone did not eliminate the timeout, so parallel load is not claimed as its sole cause.

The final narrow harness corrections allow the exact escaped HARNESS_URL origin to load directly, abort and record every other HTTP(S) origin (including a different local port), and use this spec's supported `contextOptions.reducedMotion`. Real media-query assertions verify that the setting takes effect. The ordinary video regressions, global motion configuration, application clocks, production startup and AI code/tests are unchanged. Metadata responses remain synthetic, and production Firestore, external metadata services and live AI are not called.

Fresh results and evidence under `artifacts/material-name-integration/`:
- `focused.log`: 119 passed / 5 files, exit 0. The ten name-order cases plus existing cover/dialog/search/admission coverage.
- `fresh-types.log`: fresh app/Worker checks and regenerated Worker runtime declarations, exit 0.
- `build.log`: production build, exit 0; existing dynamic-import/chunk-size notices only.
- `budget.log`: every existing bundle guard passed, exit 0. No threshold changed.
- `browser-final-results.json` / `browser-final.log`: 12 passed, zero retries, exit 0; `webkit-ci-final-collection.log` confirms all eight WebKit executions are selected by the repository CI config.
- `content-snapshot.json`, `installed-dependencies.json`: exact source hashes and 237 installed package identities checked against the unchanged lockfile. Installed dependency-lock SHA-256 remains `d7dc78db8dcc49679fd16d62f570c662e3c9514b282aea5116bbb07021e689b4`.

The final material browser spec SHA-256 is `650395b1367c612659f5fc46fb2e3a3b7d46e30c0b8764c525cf42ca7264280e`; cross-browser selection config is `3a8e7d9715fe5e0c7f015df634f97f0b4651aae6bdeb0f29736c1739dc90e9db`. Production and unit-test hashes remain exactly the original values recorded above. Environment: Node 24.19.0, Vitest 3.2.7, Vite 6.4.3, Wrangler 4.143.1, Playwright 1.62.1, Chrome for Testing 155 and WebKit 26.5. This is cloud-headless desktop/mobile-emulation evidence, not a physical iPhone claim.

Release handoff: reuse `fix/material-name-selection` and Issue #437. No new Issue, branch or PR was created, and no branch was deleted by this integration worker. Full-unit/integration-suite verification, exact-head remote CI/review, publication, main merge and deployment are still pending and belong to the release writer. The writer must review the final diff, retain the #540 infrastructure provenance above, and recheck changed integration inputs before release. This local verification does not close the umbrella Issue or claim the broader save/read races are solved.

## Theme-main source checkpoint — 2026-10-09 10:33 UTC

The release writer returned the unchanged, unpublished local branch at `355e069d`. Current main `77fd7085d0f0b1be662cf23589fb9517c557ead5` introduces the appearance provider and optional pixel theme. This main is integrated with a normal merge. The only conflict was the mobile WebKit test-selection list; the resolution retains both appearance specs, material-name regressions and every previous entry. The same #540 split workflow is now on main, so its duplicate main-relative diff disappears without a replacement workflow or changed gate.

The name guard and unit cases are unchanged. This new integration was UNVERIFIED at the source checkpoint; fresh results follow below. The previous 119 tests / fresh types / build / 12 browser successes above belong to main 32623e36 and must not be presented as current-main results. Next: focused material and appearance-boundary checks, fresh types/build/budget and synthetic standard/pixel editor interactions; full suite and publication CI remain the release writer's responsibility. Issue #437 stays open; no duplicate PR, remote branch or GitHub write is made by this worker.

### Theme-main verification result — 2026-10-09 10:38 UTC

New results on merge `29cb4ebcfe6d028cf94e2b1a1567f46cbfc6e9f6`, tree `61e3281b7043a045441b95c682b2779466a77b1d`, with current base `77fd7085`:
- Focused: 141 passed / 8 files, exit 0. The previous material/cover/search/admission set is joined by real App material handoff (9), shared appearance provider (3), and appearance preference (10).
- Fresh non-incremental app/Worker types and regenerated Worker runtime declarations: exit 0.
- Production build: exit 0, 16.18 seconds. Existing chunk/dynamic-import notices only.
- Every current-main asset guard passed unchanged: JS raw/gzip 2202.1/593.0 KiB, CSS raw/gzip 480.4/81.4 KiB, optional pixel CSS 6,999 bytes and WOFF2 500,340 bytes.
- Standard/pixel browser interactions: 8 passed, zero failed/skipped/retried, 85.2 seconds. Standard Chromium checks the existing four 390/1280 cases. A saved local supplemental harness reuses every original assertion at pixel Chromium 1280 (2 cases) and pixel mobile WebKit 390 (2 cases).

The supplemental harness selects pixel through the real settings UI before opening the editor, confirms the loaded DotGothic16 face/computed font, and checks pixel persistence across save/reload. It preserves the delayed edit, clear/save-disabled, explicit reselection, close/reopen, durable saved catalogue identity, exact viewport, real reduced-motion and zero external-request assertions with the original 30-second limit. Its Vite wrapper only serves this repository's committed public font assets; production behavior and repository test sources are unchanged. Pixel mobile preserved-name and desktop empty-name screenshots were inspected. No new live metadata/Firestore/AI calls are introduced.

Independent read-only review of `29cb4ebc` found no blocker in the guard, editor lifetime, cover/TOC/save boundaries or stable appearance-provider ownership. Appearance source files are identical to main; name production/unit/browser sources are identical to `355e069d`. The one WebKit merge conflict retains the material spec plus both appearance specs and every pre-existing entry. CI collection confirms 389 executions, including 8 material and 16 appearance executions. The duplicate #540 workflow diff is absent against current main.

Evidence is under `artifacts/material-name-theme-integration/`: focused/type/build/budget logs and exit receipts, repository CI collection, the supplemental test/config, its adaptation record, browser JSON/log/screenshots, and a fresh installed-dependency inventory (237 checked, zero mismatches, unchanged lockfiles). These results are separate from the earlier main-326 evidence. Full suite, all remote project combinations, required CI/review, PR publication, main merge and deployment are still pending with the release writer; no physical-device claim is made.
