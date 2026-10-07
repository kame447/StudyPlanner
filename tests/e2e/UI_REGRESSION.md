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

## Schedule touch-scroll evidence

`schedule-touch-drag-background-lock.spec.mjs` belongs to the broad Chromium gate. It uses CDP `Input.dispatchTouchEvent`, not DOM-dispatched `TouchEvent` objects, to exercise native gesture arbitration. Each day/short-screen-week case first proves the actual nested scroll owner can move with an ordinary swipe over a plan. It then observes document and nested scroll offsets through long press (including an 8px pre-hold finger-jitter case), the first and subsequent drag moves, and drop/cancel/stationary release. A new ordinary swipe must work after release. Scroll-event/frame samples and touch trust/cancellation metadata are attached as `native-touch-scroll-evidence` JSON.

A stationary long press still reveals the existing action without displaying a drag overlay. Once the hold has been recognized, that touch sequence is reserved until the finger is released, so the first movement cannot also start background scrolling. Quick taps and swipes made before the hold threshold retain their normal behavior.

A passing result establishes the Chromium mobile-emulation contract only. It does not verify Android hardware, iOS Safari native scrolling, rubber-banding, or OS-level touch cancellation. The cross-browser smoke configuration does not run this CDP-only spec, and a WebKit test driven by synthetic DOM touch events would not close that gap. Before claiming an iOS-native fix, check the same day and short-height week flows on iOS Safari with real touch input: swipe before holding, hold then drag at a non-edge scroll position, release and swipe again, and repeat after an interrupted gesture. Record the browser/device and observed scroll behavior separately from Chromium CI results.
