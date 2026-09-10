# Scheduling roadmap

Status: completed canonical baseline
Updated: 2026-09-10
Owner Issue: #278 — completed
Implementation PRs: #279 / #282 — merged
Final consumer follow-up: `f846cfb874c4c26a9bfa355d8c5fe56c911ac705` — merged directly to `main` under the existing Issue checkpoint

## Current state

The scheduled-event authority migration is complete.

```text
legacy Plan / MonthEvent
   └─ deterministic one-time migration input
                 ↓
        canonical ScheduleEvent
                 ↓
       ScheduleOccurrence
        ├─ Month
        ├─ Week
        ├─ Day
        └─ AI occupied time
```

`TimetableTemplate` remains a separate template lifecycle and joins at occurrence projection. `Todo` remains unscheduled work until a concrete time is assigned. `Actual` remains the record of what was actually done.

## Completed phases

### Phase 1 — unified occurrence boundary

Merged by PR #279.

- Plan / MonthEvent / timetable are projected through shared `ScheduleOccurrence` semantics.
- recurrence, exclusions, multi-day existence, owner checks and source identity are resolved once instead of separately by each consumer.
- MonthEvent-only commitments reach AI occupied-time projection.
- imported timetable Plans are deduplicated against the originating template occurrence.
- arbitrary stored title/memo prose is not promoted into scheduler instructions.

### Phase 2 — consumer migration

Merged by PR #279 and completed by the later Week timetable consumer follow-up.

- Month / Week / Day / AI planning consume the common occurrence boundary.
- the same scheduled item keeps consistent identity and time semantics across views.
- `busy=false` remains a displayable event without becoming occupied time.
- Week receives timetable template / term inputs through the same projection path instead of omitting unimported timetable occurrences.
- timetable-template occurrences are display/read-only in Week, while imported timetable Plans remain normal editable scheduled events.

### Phase 3 — canonical persistence

Merged by PR #282 as `4cbf7d7b18e337ff8c6903bc37211c544bf01c55`.

- persisted `ScheduleEvent` schema v1 owns scheduled persistence.
- study/general details are represented as discriminated details rather than separate persistence authorities.
- Plan / MonthEvent remain compatibility shapes for existing callers, not independent post-cutover truths.
- canonical ids use source-prefixed identity (`plan:<id>` / `month-event:<id>`) while compatibility keeps legacy Plan identity where Actual/Todo/provenance require it.
- ordinary CRUD, recurring Plan + Actual mutation, Plan delete/restore, Todo scheduling, weekly-planning approval and admin reads route through the canonical authority after cutover.
- legacy records without explicit `busy` default to busy; explicit `busy=false` survives compatibility and occurrence projection.

## Migration / recovery contract

Migration is marker-first and roll-forward.

```text
create/reuse migrating marker
→ freeze legacy writes
→ read frozen legacy snapshot
→ deterministic canonical backfill
→ verify canonical snapshot
→ completed marker
→ ScheduleEvent is authoritative
```

Safety invariants:

- no indefinite dual-write.
- canonical writes require the migration boundary to be active.
- legacy writes are frozen after marker creation.
- concurrent clients may repeat the same deterministic migration safely.
- delayed clients cannot overwrite post-cutover canonical edits with a stale legacy snapshot; each backfill chunk is guarded by the migration marker in the same Firestore transaction.
- an identical concurrent completion is idempotent; mismatched completion fails closed.
- legacy data retained after cutover is recovery/forensic evidence, not a second write authority.
- rollback must remain ScheduleEvent-aware; returning a cutover user to a legacy-writing client is not a supported rollback.

## Rules / client rollout

Client and Firestore Rules deployment do not depend on a lucky ordering.

- while the previous Rules version cannot read the migration-marker collection, the client uses only legacy authority for that operation and retries capability later.
- once migration capability is available, failures remain fail closed rather than silently falling back.
- once a marker exists, Rules freeze legacy writes.

The repository-owned production Rules path uses GitHub OIDC + Google Cloud Workload Identity Federation and no static Firebase credential.

Post-merge production evidence for PR #282:

- Firestore deploy workflow: `33747201456` — success
- WIF authentication: success
- Rules regression: success
- production deploy: success
- deployed ruleset read-back/hash verification: success
- deployed ruleset: `01430a43-a4a1-44c4-b8d5-43dd53d04cff`
- verified SHA-256: `a6881721ade2f8a47f218826edc91df0822e8d87693fddfcb1c698ab0640ade9`

## Completion evidence

Phase 3 pre-merge PR #282 head:

`3ae534fd6e888b9d56404bc045c0549aa5dfc37d`

Phase 3 merge checkpoint:

`4cbf7d7b18e337ff8c6903bc37211c544bf01c55`

Phase 3 post-merge verification:

- CI `33747201405`: success
- Browser Regression `33747201413`: 209/209 passed
- Admin Overview Render `33747201448`: success
- UI Regression Matrix `33747201454`: success, including Chromium / Firefox / WebKit smoke
- UI Quality Automation `33747201491`: success
- Deploy Firestore Rules `33747201456`: success

### Adversarial re-audit follow-up

After the Phase 3 close, #278 was re-audited against current repository evidence. The shared resolver already supported timetable templates, but the Week consumer was not passing the timetable template / active-term inputs into the common projection. This meant an unimported class could still be absent from Week while Month / Day / AI used the shared source.

The gap was fixed on `main` as:

`f846cfb874c4c26a9bfa355d8c5fe56c911ac705` — `fix: show timetable occurrences in week schedule`

Final exact-head verification for that follow-up:

- CI `34440130973`: success, including TypeScript, full tests, Firestore rules regression and production build
- Browser Regression `34440130883`: success
- UI Regression Matrix `34440130881`: visual regression and cross-browser smoke success
- UI Quality Automation `34440130856`: success
- Admin Overview Render `34440130891`: success
- Cloudflare Pages exact-head deploy check: success
- exact-head check runs: no failure, pending or in-progress result at final audit

Issue #278 was then closed as `completed` on the final baseline.

## Future work boundary

There is no active Issue #278 implementation branch. Future scheduling changes should start from the current `ScheduleEvent → ScheduleOccurrence` contract and belong to the Issue that owns the new product requirement. Do not revive the former Phase 1/2 or Phase 3 branches as parallel authorities.
