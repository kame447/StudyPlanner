# Home add expansion motion

- Status: combined local verification passed; PR publication authorized; native CI pending
- Base: 84b69b9b6a0810071e530509c5230fcc4a81d6bf
- Branch: fix/home-add-expansion-motion
- User request 2026-10-13 13:47 UTC: center plus expands sideways; accent background contracts smoothly; keep actions expanded after opening forms, close only on explicit dismissal.
- Existing #483 / merged #609 own this UI; no matching open PR after current list review. QuickEntry dialog focus is a separate worker and must remain compatible.
- Cause evidence: toggle changes discrete grid-column from full span to center; side actions animate opacity only. select calls close; outside pointer and blur also close.
- Alternatives considered: animate layout grid columns (risk surrounding reflow); add motion library (unnecessary dependency); retain static row/grid and animate toggle width plus child transforms (chosen, independently measurable).
- Next: preserve expansion state on select/outside focus, animate fixed layout, test geometry/reduced motion/rapid reversal and form round trips. Local edits only; publication requires approval.
- Validation: not yet run.

## Ownership / design recheck 2026-10-13 13:55 UTC

Re-read complete AGENTS, current HEAD/diff, #483 latest comments, matching open/closed PR search and all remote branch pages. This existing local branch is the handed-off owner. #609 is merged; no competing expansion-motion change. QuickEntry focus remains a separate owner and will restore to the now-retained action after integration.

Three layout approaches compared: animated grid tracks risks changing row sizing; an overlay pseudo-background decouples visible accent from the actual close hit area; a full-span grid item with centered animated width keeps accent and hit area aligned while existing fixed side columns preserve layout. Chosen last approach. Acceptance is actual intermediate width and two opposite transforms, stable row/scroll geometry, and immediate reduced motion. Native browsers cannot launch in this environment; new browser test execution awaits an authorized CI route, not an unapproved push.

## Local behavior checkpoint — 2026-10-13 14:06 UTC

- Removed automatic collapse on selection, outside pointer and blur. Explicit close and row-local Escape still disable/hide actions and return focus to the toggle. Empty-to-populated rerender retains expansion.
- The selected button is explicitly focused with preventScroll before opening its form. This ensures touch browsers that do not focus tapped buttons supply the actual action to the existing dialog return-focus hook.
- Accent width animates 100% to 44px in a fixed grid over 320ms; left/right actions translate from the center with a 0.72-to-1 scale and existing fade. Reduced motion removes transitions. Existing theme variables, grid columns and row padding are retained.
- Initial state regressions: old implementation 6 failed / 4 passed, candidate 10 passed. Selected-action focus regression: 3 failed / 7 passed before the focus call, then 10 passed. Final related scope: 4 files / 23 passed, exit 0 (TodayScheduleAddMenu, touch, HomeAddFlow, App plannerDataRecovery).
- Playwright 1.64.0 collects 43 cases in the existing four Home browser files, exit 0. Existing motion cases now sample intermediate width/transform/opacity at one shared elapsed time, both directions and rapid reversal, at 320 empty light, 390 populated pixel/dark and 1280 populated dark. Existing form tests cover cancel/save without collapsing and outside click/Tab retention. Two cases added, not a multiplied matrix. Syntax and diff checks pass. These are authored/collected cases, not executed browser evidence.
- Node 24.19.0, npm 11.9.0, Vitest 3.2.7, TypeScript 5.9.3, Wrangler 4.147.0. Private copied dependencies: 235 installed locked package versions match the lock and remain unchanged. DEV_LAN_HOST=127.0.0.1 avoids unavailable network-interface discovery. Two test startup failures occurred before actual test execution (incomplete dependency copy and missing LAN override); both logs are retained separately from behavioral red evidence.
- The release owner requested one coherent Home add interaction candidate including the separate QuickEntry focus repair. Preserve the motion-only commit and original focus branch; integrate focus into this existing branch, adapt browser focus expectations, then perform one fresh combined full verify. No motion-only full run has started. Native rendering remains unverified pending an authorized browser/CI route; no publication is authorized.

## Combined candidate — 2026-10-13 14:11 UTC

The motion-only implementation is preserved as `0fc400b3`. The independent QuickEntry focus branch `fix/quick-entry-dialog-focus` remains at `ac866669e1a0f430d73a92fd82e924d028a6d064`; its exact change was integrated as `18e3be44`. Both descend from the original base. This existing Home branch is the sole combined release candidate; no third branch/PR was created. See [the original focus evidence](quick-entry-dialog-focus-handoff.md) rather than duplicating its earlier runs. Its failed standalone full run remains a failure, not combined proof.

Independent review found a real initial reverse-Tab edge exposed by focusing the form container: `contains(container)` is true, so the prior guard allowed Shift+Tab to escape. The real shared-hook and QuickEntry tests reproduced two failures. Alternatives considered were focusing an input (violates mobile non-input entry), adding new focus sentinels (unnecessary extra policy), or including the container in the existing backward boundary. The last is the one-condition fix; ordinary forward Tab is unchanged. Combined focused verification now passes 16 files / 98 tests, including other dialog owners.

The existing keyboard browser cases now assert the first reverse Tab stays inside the form and both dismissals restore the retained study action. Native-touch QuickEntry save/cancel checks assert the selected study action's focus, and the existing cancellation case waits for the action to finish moving before measuring its real touch point. Browser collection is 45 cases / 5 files, exit 0; no browser engine was launched. Shared fixed-clock settings and existing geometry/scroll thresholds remain unchanged.

Next: independent final diff review, freeze combined input, then one fresh combined `npm run verify` when the startup-canvas verification releases the queue. Record exact tracked/untracked content, installed byte identities and generated runtime types before/after. Build budget and browser/visual gates remain separate. Publication, main integration and actual rendered acceptance are not yet authorized/verified.

Boundary: MonthEventDialog has no focus-restoration owner. Its existing save/cancel and persistent row checks are retained, but this candidate does not claim or add schedule-form focus restoration. An initially added assertion assuming it was removed after source review disproved that contract.

Mobile motion acceptance: the shared real-transition check is reused in one new mobile-WebKit-only 390px populated pixel/dark case with normal motion explicitly enabled. The existing Chromium three-condition motion/reduced checks and 20 palette cases are retained. The broad suite excludes the WebKit-only file; no duplicate theme matrix was added. Browser execution still awaits authorized CI, including this iOS-engine boundary.

## Verification repair / authorization — 2026-10-13 14:20 UTC

The user approved this Home interaction PR and main integration after verification at 14:17 UTC. The release owner coordinates merges; this worker does not merge. Current main was re-fetched at the original `84b69b9b` and the open PR/branch search found no competing Home expansion candidate.

The first combined full run on clean `47c1302b` / tree `1dd0b2962f6e3b4b682b56ed83f09a1c36bc4f27` passed fresh app/Worker types but failed seven existing TodayScheduleSection renderer cases: their two direct action-handler calls omitted the event entirely, unlike a browser click. They now provide currentTarget.focus in the fixture. Production behavior and all original domain/renderer assertions are unchanged. That run is retained as failed (7,882 passed / 7 failed / 54 skipped / 1 todo; build not reached). The final successful proof must come from a fresh full run on the corrected snapshot.

## Final local verification — 2026-10-13 14:24 UTC

Clean verified HEAD `8fe697fd0d983353e44b4cd70a9c778ea3454c07`, tree `ce6727d34791106ae15b6506c7e8aa7371a2d4ec`. Command: `npm run verify`, with supported LAN override, bundled cf metadata (`CLOUDFLARE_CF_FETCH_ENABLED=false`), metrics disabled, and Vitest max2/min1. Exit 0: fresh non-incremental app/Worker types, regenerated runtime types, **847 files / 7,889 tests passed**, 11 skipped files / 54 skipped tests / 1 todo separately, and production build 5.12s. No lint script is configured.

All 2,452 tracked/untracked source inputs and tool executable hashes match before/after. Installed-file proof covers 19,305 files (235 locked package versions; 362 package manifests), fingerprint `3b9fceeeda854dc9c1e7c383f2c7b894071f6a67f4b26284027612adbfe057b2`, unchanged. Worker runtime types were regenerated without changing SHA-256 `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`. The final fixture correction passes its focused 31 cases.

The separate bundle gate still exits 1 in four categories already failing on verified main `84b69b9b`: total JS raw/gzip and CSS total/largest raw. Exact comparison: JS -195 raw/-48 gzip bytes; CSS +376 raw/+82 gzip bytes (also the largest CSS delta). Candidate totals are JS 2,364,690 raw/638,098 gzip and CSS 494,084 raw/83,951 gzip; largest CSS 426,106 raw. Thresholds are unchanged, and this is not an all-gates-green claim. The main baseline has a retained 47-output manifest; other workers' successes are not substituted for this candidate's full run.

Browser files were collected only: 45 Chromium cases in the five Home/focus files, plus exactly one normal-motion mobile-WebKit case. Chromium/WebKit intermediate geometry, screenshots, native touch, focus, and form round trips await the authorized PR CI. Independent source review found no remaining blocker after the initial reverse-Tab correction and removal of an unsupported MonthEvent focus assumption. Only this checkpoint is changed after the exact successful full run.

## Pre-publication static policy repair — 2026-10-13 14:36 UTC

The separate Browser Regression source-policy audit was executed locally without launching a browser by running its actual helper/test body. It rejected the new selected-action focus statement as unregistered. The exact `button.focus({ preventScroll: true });` statement is now audited only inside TodayScheduleAddMenu, whose argument is typed HTMLButtonElement and supplied only by the two button click handlers. No whole-file exception or input focus permission was added. The audit is green, and an in-memory probe adding `inputRef.current.focus();` to the same file remains rejected. This changes a browser test input, so the original full receipt is historical; the planned fresh stack verification will cover the new snapshot before publication. Preserve #621's separately audited return-button statements when stacking.

## Release stack freeze — 2026-10-13 14:49 UTC

Normal-merged verified #623 local `986835dd9f1fff5ca706e3e8d9f350100681da8a` (tree `ca0846646f438289367f655c0d906febf33b7d22`), which includes final #621 navigation and #622 initial canvas, into this existing Home branch. No conflicts or runtime edits were needed; relative to that stack base the diff is exactly the 24 Home interaction files. Both #621's two exact non-input focus statements and Home's selected-action statement remain audited. The actual source policy passes and an injected input-focus probe is still rejected. A separate fresh full receipt is required for this combined tree; previous local receipts remain historical.

Publication plan: create the single Home draft against main to admit existing PR workflows, then retarget to `perf/schedule-projection-reads` after their exact test-merge tree is recorded. Existing workflows only trigger for PRs targeting main, and no dispatch tool is exposed. No workflow or gate is weakened. The release owner alone handles final retarget/merge after browser proof.

## Final stacked proof — 2026-10-13 14:55 UTC

Fresh `npm run verify` passed on clean `ccdbad909e067d2d2587378d425049167c79b9ed`, tree `c78587d413da9535e00a4344c8e5dce9b32483d3`: app/Worker types and generated runtime types, 852 files / 7,928 tests passed, and build 5.08s. The 11 skipped files / 54 skipped tests / 1 todo remain separate. All 2,467 source inputs, 19,305 installed files, tool bytes, environment, local ignored inputs and generated types match before/after. Dependency fingerprint remains `3b9fceeeda854dc9c1e7c383f2c7b894071f6a67f4b26284027612adbfe057b2`; full log SHA-256 is `e2b9b3be78213abf43006a9beb84fe8ab240f33caa53d866f4470ca5e72e2e30`.

After that full, normal-merged final #623 local `bcff9f9f17646bf85a6da983d11ad41d6152a483` / tree `4d0ff633f6d3f10e5d29ad796b89f1aeb04d4542`. Its delta is one checkpoint sentence and the independently reviewed startup E2E portability correction: Firefox lacks the reflected playsInline property, so the assertion now reads the actual playsinline attribute, plus two explanatory comments. No production, unit, type, configuration or dependency input changed. Per release-owner direction, the identical app/Worker full was not repeated. The final spec passed syntax and 56 cross-browser collection; native CI will validate the final complete tree. The source-focus audit and rejected new-input probe still pass. Home collection remains 45 Chromium cases / five files and one bounded mobile-WebKit normal-motion case.

The exact #623 build comparison uses Node 24.19.0 / zlib 1.3.2.1 gzip level 9. Home adds 376 raw / 82 gzip CSS bytes and removes 195 raw / 69 gzip JS bytes. Candidate totals: JS 2,366,898 raw / 638,831 gzip; CSS 494,367 raw / 83,986 gzip; largest CSS 426,389 raw. The same four inherited bundle categories fail unchanged thresholds. This is not an all-gates-green claim. Browser motion, native touch/focus and visual acceptance still require final PR CI.
