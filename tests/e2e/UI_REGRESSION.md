# UI Regression Gates

The existing `Browser Regression` workflow is the broad Chromium E2E gate. It owns functional browser contracts and intentionally does not multiply the complete E2E suite across every browser engine.

Focused QA specs are explicitly excluded from the broad `tests/e2e/playwright.config.mjs` run:

- `visual-regression.spec.mjs`
- `cross-browser-smoke.spec.mjs`
- `quality-gates.spec.mjs`

Each focused configuration clears that exclusion and selects only its own spec. This prevents duplicated execution, prevents axe-only dependencies from leaking into the broad E2E job, and keeps screenshot project metadata out of normal browser contracts.

`UI Regression Matrix` owns two focused gates. Visual Regression uses Chromium at desktop/mobile sizes in light/dark mode and compares approved screenshots. Cross-browser smoke uses Chromium, Firefox, desktop WebKit, and mobile WebKit only for primary-surface compatibility checks. Full E2E is not repeated across all four engines because the runtime and flaky-test cost would be disproportionate to the additional signal.

Visual snapshots are an explicit product contract. A changed screenshot must not be accepted merely to make CI green. Inspect expected, actual, and diff artifacts first; regenerate only affected baselines when the UI change is independently confirmed as intentional.

The broad E2E and each focused Playwright configuration emit machine-readable JSON in CI in addition to human-readable reports. On the default branch, `/qa e2e` runs the existing broad Browser Regression, while `/qa visual` and `/qa cross-browser` run the focused matrix. Additional accessibility, responsive-boundary, runtime-health, bundle-budget, performance, stability, and test-intelligence automation is documented in `tests/quality/QUALITY_AUTOMATION.md`.

## Responsive header and compact Home

The primary header keeps the complete year/month/day/weekday. At narrow widths or enlarged text it can use two rows instead of clipping digits or reducing the type size. `primary-header-responsive.spec.mjs` checks the text ranges, control bounds and footer across four browser projects, including September 10 at 393px and 200% text.

Ordinary Home sizes keep the existing bounded overview contract. When width is at most 336px and height at most 640px, or height is at most 480px, only the Home body scrolls. Its schedule rows and add action retain their natural height; the header and navigation remain in their viewport slots. This deliberately replaces the compact-only requirement that every card must be above the footer before scrolling. It must not replace clipping with unreachable content below the footer.

The compact Home outer shell uses `overflow: clip`, rather than a hidden scroll container that browser focus/scroll-into-view can pan. This selector requires a real Home body and does not affect AI, dialogs or preview shells. Both Home containment specs retain normal-size grid/inner-scroll assertions and use the shared compact reachability contract for compact sizes. Chromium reaches cards with native wheel input; mobile WebKit's reader-position setup modifies only the Home body's scroll position. Real Tab navigation to the add action, click/cancel, fixed chrome and document/shell scroll offsets remain assertions, with ancestor geometry included on failure.

`home-layout-responsive.spec.mjs` runs in broad Chromium and mobile WebKit. At 320×568 and 852×393, one-plan and four-plan fixtures must scroll each whole card and the whole add action into the body viewport, keep the header/navigation stationary and the document unscrolled, and open/cancel the add chooser. Computed body overflow must be `auto`, and Chromium proves a native wheel changes its scroll position before checking reachability. Mobile WebKit does not support Playwright's wheel API, so its DOM reader-position fixture proves layout/control boundaries only. Normal-size containment assertions remain unchanged. Successful header and compact-Home screenshots are written to `testInfo.outputPath` for compact CI image artifacts. These are emulated browser checks, not physical iPhone touch/keyboard evidence.

## Schedule touch-scroll evidence

`schedule-touch-drag-background-lock.spec.mjs` belongs to the broad Chromium gate. It uses CDP `Input.dispatchTouchEvent`, not DOM-dispatched `TouchEvent` objects, to exercise native gesture arbitration. Each day/short-screen-week case first proves the actual nested scroll owner can move with an ordinary swipe over a plan. It then observes document and nested scroll offsets through long press (including an 8px pre-hold finger-jitter case), the first and subsequent drag moves, and drop/cancel/stationary release. A new ordinary swipe must work after release. Scroll-event/frame samples and touch trust/cancellation metadata are attached as `native-touch-scroll-evidence` JSON.

A stationary long press still reveals the existing action without displaying a drag overlay. Once the hold has been recognized, that touch sequence is reserved until the finger is released, so the first movement cannot also start background scrolling. Quick taps and swipes made before the hold threshold retain their normal behavior.

A passing result establishes the Chromium mobile-emulation contract only. It does not verify Android hardware, iOS Safari native scrolling, rubber-banding, or OS-level touch cancellation. The cross-browser smoke configuration does not run this CDP-only spec, and a WebKit test driven by synthetic DOM touch events would not close that gap. Before claiming an iOS-native fix, check the same day and short-height week flows on iOS Safari with real touch input: swipe before holding, hold then drag at a non-edge scroll position, release and swipe again, and repeat after an interrupted gesture. Record the browser/device and observed scroll behavior separately from Chromium CI results.

### Unplanned study Home CTA baseline (2026-10-08)

The two mobile Home baselines use reviewed PR #540 head `65cd16c7e5a8d2af44f93fea223641cbd8aba8c7` output from Matrix run `37711535568`, compact artifact `11522191528` (SHA-256 `9e06a93d5e02570f4cdddc96bdc7b764540dd53688fd1fcb0fde2630ebb3565d`). Both light and dark images were inspected. Compared with the accepted scheduled-student baselines, all changed pixels are inside `(135,265)–(254,287)` and represent only the intentional CTA wording from `学習を開始する` to `勉強を開始`.

The final runtime differs from the image-producing head only in compact-Home CSS scoped to `(max-width: 336px) and (max-height: 640px), (max-height: 480px)`. Neither condition applies to the actual golden viewport of 390×844. Visual spec, fixture and other runtime inputs are unchanged. Keep all six non-Home mobile header baselines as accepted by the header owner, all desktop baselines unchanged, and the existing thresholds unchanged. The new main/PR Matrix run remains required; adopting these reviewed images is not a claim that the final browser gate has passed.
