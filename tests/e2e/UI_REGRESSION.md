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

## Browser change selection (local candidate)

Status: active local implementation; not published.
Owner branch: `ci/browser-change-selection`; base `e6ce01091319bd47b6cf66ef35fc4f444924d69a`.

The Browser Regression workflow currently starts its entire Chromium suite on every
PR and main push, including documentation and QA-report-only changes. This candidate
keeps its existing job/check identity and security workflows while adding an explicit,
reviewable change-selection receipt before expensive setup. The initial scope is a
small non-runtime allowlist and reviewed isolated spec edits. Runtime/shared/unknown
changes retain the full browser selection; this is not a source dependency graph.

Checkpoint: ownership checked against #570 (development Vitest diagnostics only) and
#575 (UI Matrix image preparation only). Focused selector/real-Git/runner-contract
checks (6 files, 142 passes) and native collection are complete. Independent
review found no blocker in the bounded selection and preserved security boundaries. No browser execution, dispatch, deployment,
branch-protection change or full-suite rerun is authorized by this local task.

The latest user instruction requests related tests only. AGENTS still describes a
final full `npm run verify`; the coordinator must reconcile that local policy before
publication. This candidate does not change AGENTS, CI/security gates, required check
settings, UI Matrix admission, or the separate #382 stability prototype.

### Bounded selection contract

- PRs compare the complete merge-base-to-head diff and verify the checked-out merge
  includes both event commits. Pushes compare `before..after`, including all commits.
  Missing/invalid/zero SHAs, missing history, empty or unsupported diffs and uncertain
  ownership broaden to full; unreadable event data fails the job. Rename detection is
  disabled so the old and new paths both participate. Filenames remain NUL-delimited.
- Only the explicit documentation/repository metadata allowlist can yield `none`.
  That skips browser installation, application dependencies, build and browser run,
  and uploads a selection receipt. The existing `chromium` check still executes.
- Modified regular `app-settings-page.spec.mjs` and
  `study-session-pomodoro-settings.spec.mjs` can yield `specs`. These reviewed specs
  have file-local helpers and use the existing fixed-clock fixture. Changes to that
  shared fixture, any helper/config, additions/deletions/renames, or other specs
  broaden to full. An explicit inbound reference from another tracked code module
  invalidates the opt-in; config ownership globs are not module imports. Dynamic
  import/require/glob loaders in a runner config also broaden to full.
- This small opt-in is not a general dependency graph. Constructed dynamic references
  and new process-wide side effects inside a spec require review and removal of its
  opt-in if isolation is lost. Runtime source, shared CSS, authentication/bootstrap,
  persistence/repositories, Workers, Rules, dependencies/lockfiles, CI/deploy helpers
  and unknown paths retain full Chromium coverage. Admin/Announcements runtime changes
  therefore still receive the full automatic selection.
- The exact-path filters reuse the existing manual WebKit convention: escaped,
  anchored Playwright file regular expressions passed as arguments without a shell.
  Existing assertions, retry/worker settings, 30-minute timeout and failure exit
  status remain unchanged. No `--pass-with-no-tests` is used.

Native collection on the current base (Playwright 1.64.0; no browser launch):

| Change | Before | Selected after |
| --- | ---: | ---: |
| Allowlisted docs / QA-report metadata only | 792 | 0, explicitly not needed |
| Settings spec only | 792 | 6 |
| Pomodoro settings spec only | 792 | 11 |
| Both reviewed specs only | 792 | 17 |
| Runtime/shared/unknown input or manual dispatch | 792 | 792 |

Each selected collection exactly equals the corresponding file subset of the native
full collection, with no missing/extra/duplicate identities. This counts selection,
not browser pass results or elapsed-time savings. The existing QA comment reports job
status only: a successful selected/not-needed job must not be described as a full
browser pass. Read its job summary and `browser-selection-*` artifact for scope.

The local proof includes related selector, exact-WebKit, QA-summary, verification,
Firestore deployment trust-boundary and Worker security contract tests. It does not
prove a live Actions run or existing required-check settings (their readback was
forbidden). Security/CI workflows and UI Matrix remain byte-identical to the base.
The coordinator owns any authorized publication and exact-content integration checks.
