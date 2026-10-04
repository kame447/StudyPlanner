# Local planner storage access

Status: supporting architecture contract
Updated: 2026-10-05
Parent: [Client-first execution requirements](../spec/client-first-execution-requirements.md)

This document owns the existing local fallback adapter's access boundary. It does not define a new offline replica, shared-server authority, storage format or cross-device protocol. Issue #453 owns execution evidence; #164's broader requirements remain unchanged. [Read projection recovery](planner-read-projection-recovery.md) separately owns displayed-data freshness and consumer admission.

## Problem and boundary

Local planner commands read and replace shared collection arrays. A compound command may write several collections and compensate after a later write fails. If another command runs between snapshot capture and compensation, an old whole-array replacement can destroy its newer save. Repairing the display cannot recover that lost durable data.

`createLocalPlannerRepository` is the application composition boundary. It privately constructs the existing local gateway, legacy repository and canonical ScheduleEvent-backed facade, then coordinates every final planner operation. The production local fallback and the full-App recovery harness use this factory. Raw constructors remain available as adapter/test building blocks; they are not coordinated independently.

- Operations using the same factory module instance and exact `Storage` object enter one promise queue before their repository reads or writes run
- The boundary spans the entire compound command, including compensation and compensation failure
- Readers also participate: schedule getters can migrate legacy data, and readers must not inspect an unfinished command through this facade
- Different users sharing the physical object share the queue because their records live in the same arrays. Separate `Storage` objects do not block each other
- A command returns its normal value or original rejection. The queue tail recovers after rejection so the next operation can run; existing compensation-failure errors and partial-state semantics are preserved
- Raw leaf operations must not await a callback into this non-reentrant facade. Migration uses private raw dependencies and must not reacquire the queue
- Do not release the queue merely because a timeout elapsed: a still-running writer could later overwrite a successor. Current production local gateway operations perform synchronous local storage work behind async interfaces; an indefinitely pending operation blocks its same-storage successors

## Explicit limits

This is ordering within one module instance and one object identity, not a general database transaction. Distinct wrappers over the same backing store, duplicate module copies, another realm/tab, direct `Storage` writes and raw constructors bypass it. The test harness's deliberate external-snapshot injection is such a bypass and must remain identified as test-controlled external activity.

Individual getters are serialized operations, not one atomic multi-collection snapshot. Partial writes still physically exist during a command, and failed compensation can still leave partial data. The queue does not provide crash recovery, cancellation, conditional server revisions, or cross-tab mutual exclusion.

The Firebase-backed branch is separate and unchanged. The demonstrated loss and this fix concern local fallback/development/localhost storage, not a verified incident against the public Firebase backend. Local auth writes separate keys and stays outside the planner queue; any future whole-storage reset or new writer touching planner keys must join an appropriate access boundary rather than silently bypass this one.

This boundary does not fix stale UI acknowledgments, provisional/canonical command identity, or the remaining Plan Undo projection contract. It must not be reported as completion of #437 or #164.

## Verification requirements

Use real local storage and independently controlled read/write windows. Verify unrelated and same-target inserts/updates/deletes, same-value ownership, Actual/Todo/material effects, multiple owners/factory instances, migration, read waiting, synchronous throws, original rejection identity, compensation failure and queue continuation. Negative controls must distinguish a raw/unguarded adapter from the coordinated factory.

Browser verification should use the actual application hook and factory, inject a bounded storage failure, and confirm the competing save survives a real reload. A passing unit probe or syntax check is not browser execution evidence. Keep Firebase controls and existing projection-recovery/browser scenarios intact.
