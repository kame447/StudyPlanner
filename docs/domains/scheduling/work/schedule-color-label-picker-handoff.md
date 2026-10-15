# Schedule color label picker

Status: active local implementation; not published.

- Owner: existing UI umbrella #483; follow-up to merged #663.
- Branch: `ui/schedule-color-label-picker`; base/initial HEAD `b4b82e578b777828fc87a0e4d87df306eeb4d652`.
- Preflight: inspected current AGENTS.md, main, relevant old implementation, #483 latest checkpoints, merged #663 and open PRs/current color and schedule branches. No active matching label-picker work was found; old color branches belong to merged work. No new Issue/PR, remote write or branch deletion.
- Scope: place a compact label row directly below event dates/times; disclose named color choices with native radio selection in a small dialog/sheet. Preserve the existing five keys, automatic reset, all save and recurring edit boundaries. No new label-management feature, palette expansion or Worker change.
- Alternatives: retaining all chips would not match the requested compact row; a native select cannot reliably match the reference's named radio list; a native dialog with native radios reuses browser focus containment, Escape and modal behavior without adding a second overlay/focus framework.
- Next: implement the local UI and focused selection/persistence/recurrence tests; update affected browser assertions without changing shared runner configuration. Parent owns integration/full verification, visual verification and any later authorized publication.
- Exit: exact local diff plus focused test evidence; explicitly report unverified browser/full/integration boundaries.

## Local implementation evidence

The label row now directly follows the start/end time section. It shows the current color name and swatch, opening a native dialog with the existing five named colors plus automatic. The dialog is a bottom sheet at mobile widths. Selection updates only the editor draft; Done, Escape and backdrop dismissal return to the editor. Actual event persistence still requires the existing Save action. Native dialog focus containment/return is used as in the existing Announcements surface; no generic popup framework or dependency was introduced.

On 2026-10-15, exact changed runtime/test inputs over the base above passed:

- `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/MonthEventColorPicker.test.tsx src/components/MonthEventDialog.selection.test.tsx src/components/MonthEventDialog.persistence.test.tsx src/components/scheduleEventColorConsistency.test.tsx src/lib/scheduleEventColor.test.ts src/lib/monthEventEditor.test.ts src/domain/recurringMonthEvent.test.ts --maxWorkers=2`: 7 files / 76 tests, exit 0, no React warnings in the final run.
- `npm run typecheck:app`: exit 0.
- `node --check tests/e2e/schedule-event-colors.spec.mjs`: exit 0.
- Existing Playwright spec discovery: 7 Chromium cases collected, exit 0. This is collection only, not browser execution. The same six color cases remain in mobile WebKit through the existing cross-browser configuration.
- `git diff --check`: exit 0.

Coverage includes row order, lazy radio disclosure, all saved selections, modal open/focus/close calls, no implicit selection when opening/dismissing, disabled controls, explicit blue save, automatic-reset property plus repository payload/reopening, and unchanged single/future recurring edit requests. Existing color resolver, six-surface rendering, range validation and recurrence tests also passed. Browser assertions now cover the closed row, list screenshot, native keyboard radio selection, focus return, desktop/mobile containment, 44px row targets and save/reload/reset.

Execution identity: Node 24.19.0; TypeScript 5.9.3; React/react-test-renderer 18.3.1; Vitest 3.2.7; lucide-react 1.14.0. The existing shared installed dependency tree was linked read-only for consumption; no packages, dependency manifests or runner settings were changed. Browser collection used the existing Playwright 1.62.1 installation, not the CI-pinned native runtime.

Changed runtime/test input digest (SHA-256 of the sorted JSON map of the seven paths to their SHA-256 values): `eff54758c1bc0efa70d27e3e5b3075093bc29d9090e23d55f05bcafb45562d4c`. Only this checkpoint and the scheduling README were edited after the successful checks.

Remaining for the integration owner: combined full `npm run verify`, actual desktop/mobile browser and rendered screenshot review, then any explicitly authorized publication. Local native launch was not retried because the current environment already has verified socket `EPERM` failure evidence. No browser success, physical-device behavior, production save, full build or Worker typecheck is claimed by this implementation worker. No remote branch/PR/merge was created. Keep this sole task branch until integration acceptance, then include it in authorized cleanup.


## Independent review correction

The first local implementation is commit `3ba2a825ef939a01b3907b6ae3a9ee51b91f6473`. Review found two browser-boundary defects: closing from layout-effect cleanup could occur after React had removed the native dialog, losing focus restoration; and keeping the top-layer dialog inside the editor DOM exposed its short-screen header to the parent's document-capture drag-dismiss handler.

The correction closes the dialog synchronously before removing it for all three dismissal actions and portals it to `document.body`, following the existing TimeWheelPicker pattern. The shared drag-dismiss implementation is unchanged. Independent re-review confirmed both causal paths are removed and found no additional static blocker.

- A callback-order regression fails all three Done/Escape/backdrop cases on the prior implementation and passes after the correction. Merely checking that close was eventually called did not detect this boundary.
- Final focused checks: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/MonthEventColorPicker.test.tsx src/components/MonthEventDialog.selection.test.tsx src/components/MonthEventDialog.persistence.test.tsx src/lib/bottomSheetDragDismiss.test.ts --maxWorkers=2`: 4 files / 34 tests passed, exit 0. These are correction-scope results, not additional tests to add to the previous snapshot's total.
- `npm run typecheck:app`, browser-spec syntax and `git diff --check`: exit 0. Existing browser spec discovery now collects 8 cases, including a 320x320 header drag that must retain the parent draft. Browser execution remains unverified.
- Portal target and synchronous close order are unit-tested. Actual native focus restoration, gesture handling and rendered visuals still require browser verification; mock/native call order is not claimed as native execution.
- Corrected changed-input digest, using the same seven-path map method: `808d2140b6dcfcec6e03f237da4775fc7e02ea7fabbd2f42a96ac0ff042c5cbf`. Runtime/tool versions and dependency installation remain as recorded above. Only this checkpoint changes after the final focused/type checks.

No remote write, shared hook change, dependency/runner configuration change, history rewrite or new branch/PR was made for the correction.
