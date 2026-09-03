# Scheduling roadmap

Status: Phase 3 canonical persistence implemented
Updated: 2026-09-03
Owner Issue: #278
Implementation PR: #282

## Current state

Phase 1 unified occurrence boundary and Phase 2 consumer migration were completed and merged through PR #279. Phase 3 implements the persistence cutover from separate Plan / MonthEvent stores to canonical `ScheduleEvent` while keeping existing UI/domain compatibility shapes behind the repository boundary.

Target flow:

```text
legacy Plan / MonthEvent
   └─ one-time deterministic migration input
                 ↓
        canonical ScheduleEvent
                 ↓
       ScheduleOccurrence
        ├─ Month
        ├─ Week
        ├─ Day
        └─ AI occupied time
```

TimetableTemplate remains a separate template lifecycle and joins only at occurrence projection.

## Phase 1/2 completed baseline

Merged main checkpoint: `2292a760dec47a5398c7ac88e6bdc98c1441aa54`.

Established invariants:

- AI occupied-time projection consumes shared `ScheduleOccurrence` semantics.
- Month / Week / Day share occurrence identity and time semantics.
- MonthEvent-only commitments are not omitted from occupied-time projection.
- timetable template and imported Plan occurrences are deduplicated by logical source occurrence identity.
- owner mismatch and invalid projection state fail closed.
- title / memo prose is not promoted into scheduler instructions.

## Phase 3 implemented scope

PR #282 is the single implementation path for Phase 3.

Implemented:

1. persisted `ScheduleEvent` schema v1 with study/general discriminated details, recurrence, multi-day range, provenance, category and explicit busy.
2. deterministic Plan / MonthEvent migration with source-prefixed canonical IDs.
3. compatibility projection back to legacy Plan / MonthEvent shapes so Actual, Todo, calendar editing and weekly-planning provenance retain stable legacy identifiers while persistence authority changes underneath.
4. localStorage and Firestore ScheduleEvent authorities behind the existing PlannerRepository facade.
5. Firestore user-level migration marker with `migrating → completed` state and legacy-write freeze from marker creation onward.
6. canonical write routing for ordinary Plan / MonthEvent writes, recurring Plan + Actual mutation, Plan delete/restore and Todo scheduling.
7. weekly-planning approval persistence switches by migration state: legacy before migration, canonical after completion, retryable failure while migrating.
8. admin scheduling reads use canonical data after completed cutover instead of treating frozen legacy Plans as current truth.
9. explicit `busy=false` survives canonical → compatibility → edit → occurrence projection and is excluded from Stable V5 occupied-time constraints. Legacy records without busy remain busy by default.
10. Browser E2E assertions verify canonical local persistence and separately verify that legacy localStorage remains frozen.
11. Firebase production startup probes migration-marker read capability so client/Rules deploy ordering cannot make schedule access fail merely because the previous Rules version is still live. During that narrow window only legacy authority is used; the next operation retries canonical migration.

## Adversarial cutover findings resolved

### Canonical write before cutover

A ScheduleEvent document could previously be written before any migration marker existed. Firestore Rules now require a migration marker for canonical writes while legacy writes are allowed only before the marker exists.

### Concurrent completion

Two clients can reach completion from the same deterministic snapshot. Repeating `completed` with the same migration identity and verified counts is treated as idempotent; a completion with different counts fails closed. `completed → migrating` remains forbidden.

### Delayed stale backfill after cutover

The more dangerous race is:

```text
A and B load the same frozen legacy snapshot
A backfills and completes
user edits canonical data
B resumes its delayed legacy backfill
```

A marker check performed before a normal batch would not prevent B from overwriting the post-cutover edit. Migration backfill is therefore guarded per chunk by a Firestore transaction that reads the migration marker and writes the chunk in the same transaction.

- if the marker is still `migrating`, the deterministic chunk may commit.
- if another client has already completed, the delayed client writes nothing and exits successfully.
- if the marker changes while the transaction is committing, Firestore retries the transaction against the new marker state.
- snapshot mismatch while migration is still active fails verification; mismatch after a concurrent completed cutover is not allowed to trigger stale overwrite.

### Rules / client deploy order

Firestore Rules and the web client deploy independently. If a new client attempted migration while the old Rules were still live, access to `schedule_event_migrations` would be denied before normal schedule reads could complete.

The production Firebase bundle now probes that capability before migration.

- marker collection unavailable with `permission-denied`: use only the legacy authority for that operation and retry the capability on the next schedule operation.
- marker collection readable: enter the normal marker-first migration path.
- any failure after migration capability is available remains fail closed and is not hidden behind legacy fallback.
- once a marker exists, Rules freeze legacy writes, so an old client cannot fork the schedule truth after cutover.

This is deployment compatibility, not dual-write and not a new persistent migration state.

### Rollback / recovery meaning

Legacy data is retained as frozen recovery evidence, not as a second write authority.

- interrupted `migrating` work resumes the same deterministic migration and rolls forward.
- completed cutover never re-enables legacy writes.
- a deployment rollback must remain ScheduleEvent-aware; returning a cutover user to an old binary that writes legacy collections is not a supported rollback because it would recreate split truth.

This is the rollback strategy required by Issue #278: preserve recoverability without allowing edit/delete drift between old and new authorities.

## Compatibility intentionally retained after persistence cutover

These are compatibility shapes, not persistence authorities:

- Plan-shaped objects remain useful for existing study editing, Actual linkage, Todo linkage and weekly-planning provenance.
- MonthEvent-shaped objects remain useful for URL, memo, checklist, location and existing general-event editors.
- Day/Week presentation may clip an already-expanded multi-day occurrence to visible day geometry.
- `ScheduleOccurrence` remains the single read-model owner for recurrence expansion, source identity, multi-day existence and busy semantics.

Physical deletion of frozen legacy collections is not required in this Phase. Their write authority is removed; retention/deletion policy can be decided separately after operational confidence is established.

## Pre-merge verification contract

The merge decision for PR #282 requires all of the following on the exact final HEAD and latest-main synthetic merge:

1. TypeScript checks.
2. full unit/integration test suite.
3. Firestore Rules emulator regression, including migration cutover restrictions.
4. production build and PR diff check.
5. Browser Regression.
6. UI Quality Automation.
7. Admin Overview Render.
8. UI Regression Matrix.
9. exact diff/current-main integration audit and zero unresolved review threads.
10. repository seven-view audit with BLOCKER/MAJOR = 0 across responsibility, contracts/callers, data invariants, UI/browser, tests/harness, security/dependencies/observability, and Git/operations/docs.

Exact run IDs, final HEAD, seven-view findings, merge state, production Rules deployment evidence and post-merge main verification belong in the durable Issue #278 checkpoint rather than being hard-coded into this roadmap.
