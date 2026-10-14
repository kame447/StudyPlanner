# Selectable general-event colors

Status: local implementation verified; combined UI integration and publication pending
Base: `70953efd`
Branch: `work/event-colors-20261014`

## Scope

Persist the user's selection from the existing five-color palette. Keep automatic source-ID colors for existing records. The color contract is documented in [scheduled-event authority](../architecture/scheduled-event-authority.md#general-event-display-color).

The dialog UI is owned by the parallel event-editor task, based on the shared implementation commit `59f6b398`. No GitHub writes, production data writes, migration execution, or permission changes were performed. Existing local migration behavior is tested using isolated memory storage only.

## Verification

Focused tests passed against the implementation and added regressions:

- Color resolution: 17 tests, including all five keys, stable automatic fallback, and unknown-value safety.
- Local persistence: 9 tests, including canonical/legacy reload, edit, clone, automatic reset, single/future recurrence scope, and existing legacy import.
- Firestore write boundaries: 18 tests, including selected color and explicit legacy reset deletion for normal saves and recurring batches.
- Calendar surfaces: 7 tests, covering day projection/fallback, week timed/spanning cards, month day sheet owner/fallback, and month color map.
- Related existing tests: scheduleEvent (9), scheduleOccurrence (18), recurringMonthEvent (17), recurringMonthEventMutationRepository (18), MonthDaySheet (2), monthViewProjection (15), DayTimeline.scheduleOccurrence (1), DayTimeline.eventColorDrag (2), WeekView.scheduleOccurrence (10).
- `npm run typecheck:app` passed; `git diff --check` passed.

Tests use the existing shared dependency installation and `DEV_LAN_HOST=127.0.0.1` to bypass this environment's unavailable network-interface enumeration. The first unconfigured Vitest command failed before tests started with `uv_interface_addresses`; the supported config override resolved it.

Full verify, production build, real-browser/visual testing, Firestore emulator/security verification and publication were not run by this implementation worker. The integration owner owns those gates on the combined exact content.

## Next action

Combine dialog UI and persistence commits, ensuring the automatic-color action retains an explicit `color: undefined` draft property. Run the combined dialog persistence tests and required integration gates before publication. Final completion requires the integrated editor to save, reload and render the selected color, with the requested recurring edit scope respected.
