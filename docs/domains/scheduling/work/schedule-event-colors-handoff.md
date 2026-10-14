# Saved schedule event colors

Status: active
Owner: schedule color repair; UI umbrella Issue #483
Branch: `fix/schedule-event-colors` (resumed existing work; no PR or remote branch)
Base/HEAD: `98f3c324` (current main at resume)
Updated: 2026-10-13 20:15 UTC

## Scope and acceptance

The same saved event must keep one accent across month pills/range bars, day sheet, editor list, week/day schedule and home. Use stable backing MonthEvent identity for general events and the existing subject/type/timetable semantic color for Plan-backed entries. Recurrence date, title edit and list order must not choose colors. No persistence/schema migration or unrelated form edits. Completion state stays distinct from event identity.

## Current state

The interrupted implementation is preserved in the worktree. It adds a shared presentation color resolver, connects six UI surfaces, removes local index/title palettes, and carries presentation-only color through home projected entries. Existing focused log reports 8 files / 51 tests passed; that log was not linked to an exact content snapshot and is not final verification. Prior app typecheck reported one unused local variable, already removed in the resumed diff but not reverified.

No open color PR or remote color branch was found in the fresh 20:14 UTC searches. Do not create a duplicate task. The form-density worker owns separate compact-record-forms.css and does not touch these selectors.

## Next steps and exit criteria

1. Review actual diff, recurrence identity and preservation of existing semantic colors/completion behavior; add missing regressions.
2. Run fresh focused tests and app/Worker typechecks, record exact snapshot/environment.
3. Coordinate serial full verification with integration owner before running full suite/build.
4. Commit coherent local implementation only. Remote publish, PR and main changes are not authorized in this handoff.
5. Browser/visual validation remains unverified because the existing local browser path was denied with EPERM; do not repeat that denied path or claim visual success. Report the remaining gate distinctly.

## Resumed verification — 2026-10-13 20:20 UTC

- Fresh focused renderer/domain tests: 9 files / 63 tests passed (`DEV_LAN_HOST=127.0.0.1 npm run test:run -- --configLoader native --maxWorkers 2 --minWorkers 1` with the nine color/month/day/week/home suites).
- `npm run typecheck` succeeded for app and Worker; runtime Worker types regenerated.
- Added browser regression covering actual painted colors at 390/1280 px in light/dark themes across month, sheet, editor, week, day and home, including reload. `node --check tests/e2e/schedule-event-colors.spec.mjs` succeeded. Browser execution/screenshots are still unverified, not a passed gate.
- Home retains the green completion marker and a separate event-color ring. Actual study record paint and draft preview palettes are unchanged. Timetable colors remain the existing semantic class color for both template-backed and imported Plans.
- Final full verification belongs to the cumulative candidate: preserve this isolated commit, then normally merge preverified four-fix candidate `8e534b31ba1f46a6b336d2f8d94e1257686eaafc` in a detached worktree. Run unmodified `npm run verify` with `DEV_LAN_HOST=127.0.0.1` and a writable `WRANGLER_LOG_PATH`, recording source/dependency identity before and after. No remote publication is authorized.

## Cumulative verification and final drag correction — 2026-10-13 20:24 UTC

- Isolated implementation commit: `ef4d9a1a6b231dee0c292afe3b22ea7070fa0628`.
- Four-fix cumulative merge: `fcc0829bd9768737779d62bdd97b183784f98af7`, tree `a0b1fa15e90faf804437bb66a3e234953d9507f1`.
- Unmodified `npm run verify` succeeded on that exact cumulative content: fresh app/Worker typechecks, 858 test files / 8,053 tests passed (54 skipped, 1 todo), production build. Before/after identity matched for 2,483 tracked source files and 19,329 installed dependency entries; the receipt lives with the integration owner's verification evidence.
- Final static review then found Day's drag overlay retained its generic accent. An optional presentation style is now passed from the original Day entry, without changing drag state, gestures or draft-preview styling. Focused Day/Week drag and cross-view regressions passed: 4 files / 18 tests. This follow-on code is not covered by the earlier full run.
- The next form-density cumulative integration owns final full verification of the drag correction plus new main `782f3559b40efaaa9fa3b176b63cbe8407b04e9e`. Do not rerun the same old-base full independently or claim the prior full covers newer content. Browser/visual checks and publication remain pending.
