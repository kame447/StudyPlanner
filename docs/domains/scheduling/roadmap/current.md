# Scheduling roadmap

Status: current execution order
Updated: 2026-09-02
Owner Issue: #278

## Current state

Phase 1 unified occurrence boundary and Phase 2 consumer migration are complete on PR #279.

Completed compatibility read path:

- AI occupied-time projection consumes the shared `ScheduleOccurrence` projection.
- Month projection uses shared occurrence identity/time semantics for study targets and displayed non-study events.
- Week view shows MonthEvent occurrences through the shared projection alongside the existing Plan interaction path.
- Day view uses shared MonthEvent occurrence/date/time semantics and maps back to the backing MonthEvent only for rich edit metadata.
- Month day sheet can show non-study Plan occurrences as scheduled items.
- timetable template occurrences and imported timetable Plans use one logical occurrence identity, preferring the persisted Plan.
- owner mismatch and invalid projection state fail closed for Stable V5 occupied-time sources.

## Phase 1/2 verified checkpoint

Code verification checkpoint: `b491c0101d1d34e62bc24dcad290f0600b318285`.

Verified on the PR merge result against the then-current `main`:

- CI #5201: success — TypeScript, full Vitest, Firestore Rules, production build and diff checks.
- Browser Regression #2462: success — 203 browser tests.
- UI Regression Matrix #939: success.
- UI Quality Automation #940: success.
- Admin Overview Render #453: success.
- open PR review threads: none.
- exact PR diff audited for duplicate recurrence / occupied-time interpretation.

Adversarial findings resolved during verification:

- recurring Plans were previously filtered by their stored anchor date before AI occupied-time projection; occurrence expansion now happens first.
- MonthEvent-only commitments could be visible in calendar UI but absent from AI occupied time; they now share the same occurrence projection.
- timetable templates could duplicate an imported Plan after the Plan clock time was edited; logical source occurrence identity now deduplicates them.
- months that fit in five visual weeks could regress the month ARIA calendar from 42 to 35 cells; the calendar now keeps its fixed 6 x 7 surface without changing variable week semantics used by reports/week pickers.
- visual regression previously encoded the absence of non-study Plan labels in Month view; the test now asserts the new labels semantically while keeping the unrelated visual baseline strict.

## Intentionally retained compatibility reads

These are not separate occurrence authorities and are retained until Phase 3 because their mutation/lifecycle ownership is still legacy-specific:

- Week/Day continue to use Plan-backed objects for Plan edit, drag, recurring mutation and Actual linkage. Cross-source recurrence/identity/occupied-time aggregation is owned by `ScheduleOccurrence`; Plan mutation semantics remain Plan-owned during compatibility.
- Day/Week presentation code may clip an already-expanded multi-day occurrence to the visible date (`00:00` / `24:00`). This is display geometry only; it does not decide recurrence, exclusions, source identity or whether the occurrence exists.
- Day/Month surfaces may map an occurrence back to its backing MonthEvent to obtain URL, memo, checklist and other rich metadata after occurrence identity/date/time has already been resolved.
- calendar views continue to consume planner state that is already scoped by the planner-data owner boundary. Stable V5 occupied-time projection receives the owner explicitly and fails closed on mismatch.

No destructive persistence migration or dual-write was introduced in Phase 1/2.

## Phase 3 — canonical ScheduleEvent persistence

Next implementation phase. Do not start with destructive schema replacement.

Execution order:

1. Define persisted `ScheduleEvent` schema and discriminated details.
2. Define deterministic legacy Plan / MonthEvent migration mapping.
3. Add idempotency ledger/version and rollback compatibility read.
4. Migrate repository write authority so one logical mutation has one truth.
5. Backfill existing records.
6. Verify recurrence, Actual linkage, Todo scheduling and weekly-planning provenance.
7. Remove legacy `month_events` authority only after read/write cutover is proven.

Phase 3 must align with Issue #164 client/server authority and must not introduce indefinite dual-write.
