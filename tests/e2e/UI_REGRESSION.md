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
