# Time-wheel numeric options boundary

Status: locally characterized before/after; independent review and integration gates pending
Updated: 2026-11-03

## Ownership and alternatives

- Base: `022a09e0d` (full SHA in the shared receipt).
- Branch: `refactor/time-wheel-numeric-options`.
- Scope: `TimeRangeFields.tsx`, new `src/lib/timeWheelOptions.ts`, and a component characterization test.
- Current main and 19 open PR changed-file lists were checked. No exact path overlap; broad actual-record work in #974 is not modified.
- Prior audit explicitly retained clamping/rounding transforms and programmatic-scroll guards. All are preserved. This is responsibility separation, not removal of supposedly redundant validation.
- MaterialContentsPhotoImport and BookshelfMaterialSearch were retained: data preparation already has library owners, while cancellation/focus/revision handling belongs to the live UI operation.

## Responsibility change

The numeric wheel rules (valid hours/minutes, five-minute rounding, range clamp
and normalization) now live together in `timeWheelOptions.ts`. The component
continues to own scroll measurement, timers, ignore-until timestamps, refs,
rendering, draft state, cancellation and commit. Role and the already-normalized
minimum are passed at the original normalization call sites; nothing is cached
across sessions or moved across a side-effect boundary.

Start versus end rules, the end-only 24:00 choice, exclusion of unavailable
minutes and every original fallback remain unchanged. DOM scroll selection and
the timing of final normalization before onChange are untouched. Component
props/public callbacks and generic date helpers are unchanged.

## Evidence / release gates

New public component cases were run before runtime edits and after extraction:
start 09:02 rounds to 09:05, a 09:03 minimum excludes earlier choices, a 23:59
minimum offers only 24:00, and selecting midnight then cancelling does not write.
Existing overnight-entry and month-event persistence tests were included.

- Before and after: 3 files / 31 tests passed, exit 0.
- Logs: `/tmp/client-time-wheel-proof/before-final.log` and `after-final.log`.
- Fresh app typecheck and independent review are recorded in the shared receipt.
- Renderer tests do not claim real DOM scrolling/visual/browser proof. Exact-content full integration and applicable native/browser gates remain separate.
- Revert this logical change for rollback; no data migration or persisted schema.
- Local-only candidate. No external write is authorized by this checkpoint.

The initial app typecheck rejected Array.at in the new test because the project
lib target does not include it. The assertion now uses equivalent slice(-1)[0];
production code and expected behavior were unchanged. The final test was rerun
against both the original and extracted component, with 31/31 passing each.
Initial diagnostic: `/tmp/client-time-wheel-proof/types-initial-test-api-failure.log`.
