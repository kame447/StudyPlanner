# Single-event deletion wording

Status: implementation and focused verification complete; awaiting combined release verification
Branch: `fix/single-event-delete-label`
Base: `70953efd` (approved UI integration)
Scope: classify the original event's recurrence before choosing occurrence-removal wording. One-off events, including cross-day events, say `予定を削除`; recurring events and timetable occurrences retain scoped wording. Preserve all cancellation, dependent-record, and Undo behavior.

Existing Issues/PRs were searched read-only; #541 owns the earlier occurrence-removal implementation, with no existing task for this wording correction. The release coordinator is the sole GitHub writer. No upstream writes are authorized here. The parallel recurring-edit scope changes affect MonthEventDialog and do not overlap this presentation responsibility.

Candidates checked: the day-detail fallback label, missing recurrence context in occurrence projection, and the shared presentation helper's date-only condition. The helper is called for every selected event and has no recurrence context, so changing only the fallback or only the button would not fix all paths. Supply original source recurrence to that presentation boundary without changing the occurrence identity/data model or cancellation behavior.

Next: release coordinator integrates the implementation. Worker completion: exact diff review and focused tests; full combined verification and native browser checks belong to the release coordinator.

## Focused verification completed

- Presentation now resolves recurrence from the original owner-matched Plan/MonthEvent source. Explicit recurrence rules take precedence over the legacy repeat summary: a sole date rule is one-off, multiple dates or periodic rules are recurring. Timetable identity remains scoped even when represented by an imported one-off Plan.
- One-off events always say `予定を削除`, including multi-day events. Multi-day descriptions refer to the whole event and retained records without implying other occurrences exist. Recurring overnight entries retain `この回だけ削除`; other recurring/timetable entries retain `この日だけ削除`.
- Detail and long-press confirmation share the same presentation function. Mutation callbacks, occurrence identity, deletion targets, cancellation persistence and Undo were not changed.
- Final focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/lib/dayOccurrenceCancellationPresentation.test.ts src/components/DayTimetableSelection.test.tsx src/components/DayViewDialogs.test.tsx src/domain/dayOccurrenceCancellation.test.ts --maxWorkers=1 --minWorkers=1`: exit 0, 4 files / 47 tests passed.
- `npm run typecheck:app`: exit 0. `git diff --check`: exit 0.
- Initial runner startup without DEV_LAN_HOST hit sandbox network-interface discovery; the explicit configured host resolves that harness issue. New test fixtures initially omitted required locationTags and selected timed cards for all-day/multi-day entries; both fixture issues were corrected, without weakening production assertions.
- Runtime/test snapshot is `eb7adef85535395128cc0a874fbf08c45cb0ff34` / tree `d873de57fb8d96512b0fe069673177b3921f7458`, based on `70953efd`; no dependency/config changes. Installed dependencies are shared from the durable AI-turn workspace: Node 24.19.0, Vitest 3.2.7, TypeScript 5.9.3.
- Existing E2E exact `この日だけ削除` assertions target recurring/timetable data and remain valid. Full-suite/build/native browser/visual and production verification were deliberately not run by this worker; the integration owner owns those combined-content checks. No GitHub writes, browser startup, or Codex delegation occurred.
