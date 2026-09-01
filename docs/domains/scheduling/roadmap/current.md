# Scheduling roadmap

Status: current execution order
Updated: 2026-09-02
Owner Issue: #278

## Current state

Phase 1 unified occurrence boundary is implemented on PR #279.

Phase 2 consumer migration is in progress on the same PR:

- AI occupied-time projection: migrated
- Month projection: migrated to occurrence identity/time semantics for study targets and displayed non-study events
- Week view: MonthEvent occurrence visibility added through the shared projection
- Day view: MonthEvent recurrence/date/time slicing migrated through the shared projection

## Remaining before Phase 1/2 checkpoint closes

1. Run required TypeScript, full Vitest, production build and browser/UI regression on the final Phase 1/2 diff.
2. Audit exact PR diff for direct duplicate recurrence / occupied-time interpretation.
3. Audit open review threads.
4. Record any intentionally retained compatibility reads and why they do not own occurrence semantics.

## Phase 3 — canonical ScheduleEvent persistence

Do not start with destructive schema replacement.

Execution order:

1. Define persisted `ScheduleEvent` schema and discriminated details.
2. Define deterministic legacy Plan / MonthEvent migration mapping.
3. Add idempotency ledger/version and rollback compatibility read.
4. Migrate repository write authority so one logical mutation has one truth.
5. Backfill existing records.
6. Verify recurrence, Actual linkage, Todo scheduling and weekly-planning provenance.
7. Remove legacy `month_events` authority only after read/write cutover is proven.

Phase 3 must align with Issue #164 client/server authority and must not introduce indefinite dual-write.
