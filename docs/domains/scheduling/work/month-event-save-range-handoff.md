# Month-event save range validation

Status: active local investigation; no published Issue or PR
Branch: `fix/month-event-save-range`
Base/initial HEAD: `1b828e77254351c2c799ff6e0b605e9fc25daacf`

## Scope and ownership

The existing month-event editor permits a later end date with an earlier or equal
clock time. Its persistence hook still rejects every non-positive same-day clock
difference before considering dates. Investigate that specific mismatch through
the real hook and canonical local ScheduleEvent repository. Do not change Actual
editors (PR #650), persistence schemas, Firestore/cache, AI or other writers.

Current open/closed Issues and PRs, all 134 remote branch names, and the latest
#437 comments were inspected before implementation. #437 owns save/read ordering;
this range-validation defect is a distinct candidate requiring an independent
Issue if reproduced. PR #191 already established multi-day editing and is closed.
No active branch or PR represents this exact save-validation scope.

## Evidence plan

1. Prove valid multi-day drafts are rejected by the unchanged hook while its
   editor validator accepts them; use real canonical persistence and reload.
2. Distinguish hook rejection from repository loss or UI date normalization.
3. If reproduced, reuse the existing range validator at the hook boundary rather
   than introduce a separate duration policy. Keep same-day/invalid-range guards.
4. Run focused UI/hook/persistence regressions and types, review the exact diff,
   then coordinate full verification with the integration owner.

No live data or provider calls. Native browser execution is not yet verified;
known local Chromium startup socket EPERM will not be retried. Upstream push,
PR publication and merge remain outside this local task until approval.

## Reproduction and minimal correction

Unchanged production main failed five of seven real-hook/canonical-repository
cases: next-day earlier end time, next-day equal time, a three-day range and an
existing edit were rejected; an end date before the start date was persisted.
The two same-day invalid-time controls passed. Baseline raw output is retained at
`/workspace/shared/month-event-range-baseline.log` in the local work environment.

The correction imports and uses the existing editor validator in `saveMonthEvent`
with a trimmed title for validation only. Stored metadata, repository authority,
IDs, selection, optimistic settlement and retry behavior are unchanged. The
production delta is five additions and eight deletions in one file. Keeping the
old clock-only check demonstrably fails; duplicating the date condition creates
another divergent policy; changing repository time semantics is unnecessary.

Focused feedback first passed 112 tests in six files. Expanded controls include
same-day positive/24:00, missing endDate compatibility, next-date midnight, blank
and whitespace titles, and real editor input → hook → canonical save → reload.
An initial optional-endDate assertion expected undefined, but the unchanged
canonical projection normalizes it to the start date; the test now asserts that
existing documented compatibility contract without changing production code.

Two native browser cases at 390px and 1280px cover create, edit to next-day equal
clock, canonical identity/data, reload and rendered range. Syntax and Playwright
discovery pass; browser execution remains unverified in this environment. These
cases will run in the existing Chromium Browser Regression suite on publication.
No cross-browser job list, timeouts, assertions or bundle budgets are changed.

The parent accepted this local correction and requested publication remain paused.
A new Issue is not yet created; Issue #437 is not used to misclassify this distinct
validation defect as another completed read/write-order fix.
