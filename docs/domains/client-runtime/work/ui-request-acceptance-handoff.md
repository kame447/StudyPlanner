# UI request acceptance gaps: subject editing and percentage disc

## PR729 compact percentage correction

Current local branch: `fix/progress-disc-text-fit`, based on `50908b6030a187b7ae1a63f33c268f4ee8e899bd`. The existing PR729 native run established a product defect in the new No10 acceptance path: at 390px and 200% root text, the loaded DotGothic16 `100%` label/text range is 41px wide in Chromium while the inner disc is 40px. Both light/dark cases fail; Firefox independently reports the same overflow (about 40.22px into 40px). The 1280px cases fit. Screenshots and metrics were inspected; this is no longer only an unverified acceptance gap.

The correction raises both compact ring diameters and their reserved grid column from a 52px floor to 56px. At the observed compact height, the unchanged 12px inset leaves a 44px inner disc. The font, enlargement, stroke inset, existing larger-screen overrides and all native containment assertions remain unchanged. This intentionally addresses the demonstrated `100%` label at 200% text; arbitrary larger percentages and other text-enlargement levels are not newly verified.

- New source-contract tests fail against the original CSS (two geometry failures, one text-preservation pass), then pass with the correction.
- Focused verification: four files / 19 tests pass. Command: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs --config vite.config.mjs run src/styles/home-weekly-progress.test.ts src/styles/appearance-pixel.test.ts src/components/home/WeeklyProgressSection.test.tsx src/components/HomeLiveClock.test.tsx --reporter=verbose`.
- Independent review inspected the native metrics/image, exact CSS and source test, preserved native spec hash, baseline failures and focused pass. No source blocker was found.
- Local evidence: `artifacts/progress-disc/receipt.json`, `ci-metrics-summary.json`, `style-baseline.log`, `focused.log`. The source-contract check is not a native layout pass.
- Next: the integration owner combines this scoped correction with independently reviewed delivery-test corrections, builds once, and observes the unchanged native geometry assertions and rendered result. Corrected native rendering is still unverified; do not call No10 resolved until that gate passes. No local browser launch or duplicate full suite was performed here.

## Original acceptance-only checkpoint

Historical status: active local test-only work for UI request umbrella [Issue #483](https://github.com/kame447/StudyPlanner/issues/483). Branch: `test/ui-request-acceptance`. Base: `7f953920c830ce88ad54b281c339656e21c3f79b`. No remote branch/PR or publication approval.

Scope: No14's unset-subject timer save → Day editor → subject update → same-ID reload, and No10's 100% label containment within the inner progress disc with the loaded bundled pixel font and 200% text. Existing unit tests already exercise same-ID subject updating; existing browser coverage enters a subject before the first save and checks only outer-ring fit. These are missing acceptance paths, not established product defects.

Implement only focused additions to the two existing browser specs. Preserve existing scenarios and leave product, shared browser config, CI, assertions in unrelated tests and motion-owned work untouched. Native browser execution is outside this local assignment; do not retry a previously denied launch or claim collected tests passed in a browser.

The bounded journeys, pinned Playwright 1.64.0 collection, related unit checks and independent source review are recorded below. Final integration and authorized native screenshots remain required for behavioral acceptance.

## Local candidate and verification

- No14 adds two real-app journeys at 390/1280px. Each starts and ends an unplanned timer, verifies the initially saved subject is empty, opens the row through Schedule → Day, changes only its subject, then reloads/reopens it. Assertions retain one persisted row, its generated ID, owner, title, date, start/end times and note; no plan is created. A per-test opt-in seed guard prevents the new reload from clearing the saved row. Existing session cases retain their prior seeding behavior.
- Time expectation follows `createStudySessionDraft` → `buildMeasuredRange`: start at the fixed local 12:00 and advance 125 seconds, then `formatClockTime` records 12:00–12:02 without rounding the end to another minute. The first saved values are also retained as the edit/reload baseline.
- No10 preserves both original standard-appearance case names and their outer-ring bounds while adding the stricter inner-disc label/inline-text bounds. Four new width/theme cases use the loaded bundled DotGothic16 face and inspect 100% and 200% root-text states. They assert actual label font-size growth and save metrics/ring screenshots before the containment assertions when executed. These checks measure layout rectangles within the disc's bounding box, not per-pixel ink or circular-edge rasterization; CSS root-text enlargement is not a physical device zoom test.
- The complete-progress fixture now writes its plan and Actual in the same initialization callback, avoiding an assumption about the order of separate `addInitScript` callbacks. Other settings cases retain the original empty-Actual fixture.
- Static syntax and `git diff --check` pass. Pinned Playwright 1.64.0 collects 53 project/case identities for these two cross-browser files versus 35 before; all previous identities remain, with 18 new identities and no duplicate. The ordinary Chromium Browser Regression config collects 23 cases (six newly added scenarios).
- Directly related existing unit checks pass: five files / 74 tests, covering unplanned save/update, standalone recovery/draft preservation, percentage markup and pixel style scope. Command: `TZ=UTC DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs --config vite.config.mjs run src/components/StudySessionView.unplanned.test.tsx src/components/StandaloneActualRecovery.integration.test.tsx src/lib/standaloneActualDrafts.test.ts src/components/home/WeeklyProgressSection.test.tsx src/styles/appearance-pixel.test.ts --reporter=verbose`.
- No product source, shared browser configuration, CI, timeout or skip condition changed. No new native browser run, screenshot result, Firestore integration, full application verification or production behavior is claimed. The new acceptance assertions may expose a real defect when first executed; do not weaken them to obtain green.
- Independent review found no blocking test-source issue, recounted all prior/new identities and independently checked the time helper. This establishes source/collection correctness only.
- Remaining: final integration checks and explicitly authorized native execution with screenshot inspection. Recollect any combined Admin/stability snapshot because this candidate adds browser identities. Publication is unapproved; the active local branch is retained, with no branch cleanup or GitHub write.
