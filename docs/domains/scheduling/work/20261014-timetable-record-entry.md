# Day timetable record entry

Status: active implementation
Branch: `fix/timetable-record-save`
Base: `70953efd`

The supplied image shows the Day projected timetable detail with time/edit/delete/open-timetable actions but no learning-record entry. It is not an attendance transaction failure. Existing open PRs, relevant timetable branches and historical PR #635 were inspected; no active duplicate record-entry implementation was found. The progress-inclusion worker changes Home metrics only.

Options inspected: writing an Actual against a virtual identity would violate linked-target ownership; adding an atomic Plan+Actual transaction expands persistence scope unnecessarily; explicitly importing the single occurrence before opening the existing record editor reuses current canonical persistence and admission. Implement the latter with an explicit import-and-record label. Canceling record entry leaves the explicitly imported Plan. Preserve grouped source identity, one-day scope, owner/lifetime guards, duplicate admission, rejected/uncertain-save behavior and existing time editing.

Baseline focused tests: Day timetable selection, class detail and Firebase attendance adapter, 3 files / 21 tests passed. This rules out no production incident; no authenticated production action or database experiment was run.

Next: implement import-and-record through the existing guarded single-occurrence materialization, focused persistence/UI regression tests and app typecheck. Root owns combined verification and publication. Full suite and browser launch are excluded by the current task instruction.

## Implementation and focused evidence

- Added an explicit “予定に反映して記録” action to projected Day timetable details. It first materializes the single grouped occurrence with the existing guarded Plan persistence; the normal Actual editor opens with the returned canonical Plan identity only after success.
- Reused the existing source reservation, stale-source/owner checks and uncertain-acknowledgement reconciliation. The timetable master, other dates, attendance and Firestore Rules are unchanged. Existing time-edit behavior uses the same internal operation.
- Retain the disabled source detail while an imported projection arrives ahead of its acknowledgement, preventing an intermediate uncovered screen/new selection from being overwritten. Owner/date/unmount changes fence the eventual editor transition.
- Canceling the Actual form retains the explicitly imported Plan; no Actual is written by opening the form.
- Focused final content: 7 files / 88 tests passed (exit 0), including Day selection/dialogs, materialization with durable Actual save/reload, grouped one-day identity, duplicate/competing writes, unknown acknowledgement, owner/date/unmount UI transitions, ordinary Actual admission against the Firebase mock boundary and Actual editor date validation.
- App TypeScript incremental check passed (exit 0) after the final source/test changes. `git diff --check` passed. Runtime: Node 24.19.0 / Vitest 3.2.7, unchanged dependencies reused by symlink from the base integration worktree. Worker sources and declarations are untouched.
- Commands: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs run --config vite.config.mjs --configLoader native --maxWorkers=1 --minWorkers=1` with the seven explicit affected test paths; `node node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile .cache/typecheck/app.tsbuildinfo`.
- One intermediate added race regression failed because the stable occurrence ID already resolved to the imported Plan, bypassing a null-only fallback. The retained in-flight template receipt now takes priority until acknowledgement; the regression passed afterward without weakened assertions.

Remaining: parent review, combined-content checks/build and authorized publication. No full suite or browser was launched. Native mobile/desktop UI, production behavior and deployed identity are unverified for this patch.
