# Month and week swipe navigation

Status: ready for integration verification
Base: 70953efd
Branch: feat/calendar-horizontal-swipe-20261014
Scope: connect MonthView and WeekView to the existing day swipe hook; preserve editing, dragging and native scrolling. No new gesture engine or remote writes.

Evidence: MonthView receives but does not consume onChangeMonth. WeekView has no period navigation callback. The former useMonthPager has no consumer. Existing useSwipeNavigation owns day touch navigation.

Alternatives considered: restore the unused animated month pager (duplicates day gesture ownership); implement independent week pointer navigation (duplicates touch and drag ownership); reuse day hook and strengthen cancellation/interaction exclusions (chosen, smallest shared behavioral boundary).

Next: verify focused hook/component regressions and hand the exact commit to the integration owner. Final integration/full-suite/browser checks belong to the integration owner, not this worker.

## Focused verification

2026-10-14: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/hooks/useSwipeNavigation.test.tsx src/components/CalendarSwipeNavigation.test.tsx src/components/WeekView.dragLifecycle.test.tsx src/components/WeekView.dateLabels.test.tsx src/components/MonthView.recurringNavigation.test.tsx src/components/RetainedPlannerKeyboard.test.tsx src/components/WeekView.scheduleOccurrence.test.tsx src/components/DayPlanDeleteRecovery.integration.test.tsx` passed: 8 files, 57 tests, exit 0.

Snapshot: base 70953efd plus this commit's implementation/tests; the final CSS toolbar `pan-y` selector is statically inspected only. Dependencies are the existing shared installation resolved at `/workspace/scratch/3b7e1f5c90f6/studyplanner-durable-ai-turns-20261014/node_modules` (Vitest 3.2.7, React 18.3.1); no dependency changes. `git diff --check` passed.

Initial failures were harness/environment only: Vite's LAN auto-detection cannot enumerate interfaces in the sandbox (use its supported DEV_LAN_HOST override); the new component harness initially omitted document event listeners, then was corrected without weakening assertions.

GitHub read-only searches for swipe / スワイプ in issues and swipe in PRs found unrelated timetable deletion, bookshelf dismissal, and old drag-lock work, not this month/week navigation request. No Issue/PR or remote branch was created or changed.

Behavior boundaries: touch-only navigation matches the day view's existing contract (72px, 1.35 direction ratio), without reactivating the unused month pager. Actual horizontal overflow in a week grid is reserved for native scrolling; the toolbar outside that overflow remains a navigation surface at all sizes. Existing 350px weekly-grid breakpoint determines only native touch-action CSS. Inputs, dialogs, schedule-card long-press/drag, cancellation and multitouch do not navigate. The synthetic click after a successful gesture is suppressed and a fresh deliberate touch clears that suppression.

Next: integration owner cherry-picks the exact commit, runs combined type/full-suite/build and browser verification. Mobile touch/visual behavior is not browser-verified by this worker. DayView changes only the existing click-capture composition and do not change day model / DayTimeline.
