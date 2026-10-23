# Record subject selection

Status: active
Branch: feat/record-subject-selection
Base: 70953efd

The supplied screenshot shows the timer completion record form. Its subject is currently free text, with no registered-subject selector. Existing standalone record editing already persists subject changes through saveStandaloneActual.

Scope: add registered-subject selection after timing, keep free text and unset subjects, reuse existing Actual saves, and verify persisted records can later be re-edited without duplicate creation. Do not change timetable recording or progress inclusion semantics.

No matching Issue/PR title was returned by repository searches for 科目 and 教科. Existing subject branches concern deletion recovery, not this feature. This local branch owns this implementation; external publication is delegated to the integration owner.

Next: implement selection and focused repository round-trip tests. Full combined verification and browser checks belong to the integration owner.

## Local implementation evidence

- App passes the existing studySubjects collection; the session provider filters it to the current owner.
- Completion form selects existing subject IDs and stores their name using the existing ActualDraft field. Free text and clearing remain available. No new repository, schema, or save boundary.
- Existing saved-record editor is reused unchanged; the form now explains where to change the subject after saving.
- Focused verification: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/StudySessionView.unplanned.test.tsx src/components/StandaloneActualRecovery.integration.test.tsx --maxWorkers=2 --minWorkers=1`, exit 0, 2 files / 47 tests passed.
- `npm run typecheck:app`, exit 0. The initial test-fixture type error (missing subject color) was corrected before this successful run.
- `git diff --check`, exit 0. Exact implementation input: base 70953efd plus App.tsx, StudySessionView.tsx and StudySessionView.unplanned.test.tsx in this commit. Node 24.19.0, Vitest 3.2.7; installed dependencies reused via the five-approved-integration worktree node_modules symlink.
- Round-trip tests cover owner filtering, selection/change after timing, unset save, later editor save retaining the same record ID, repository reload and reopening, and free text/clearing.
- No full verify, build, Worker typecheck, browser, live Firebase, or production deployment performed by this worker. Full combined verification and publication remain with the integration owner.
- Timer styling/time-input hunk and timetable recording/progress inclusion behavior are untouched.
