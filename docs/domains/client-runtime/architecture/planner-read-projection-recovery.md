# Planner read projection recovery

Status: supporting architecture contract
Updated: 2026-10-05
Parent: [Client-first execution requirements](../spec/client-first-execution-requirements.md)

This document owns the local planner read-freshness and recovery boundary under the parent requirement's account isolation and user-visible status rules (DATA-004 / OFF-004). It does not redefine durable storage, server synchronization, or the optimistic rollback requirements in SYNC-007. [Weekly planning](../../weekly-planning/architecture/current-contract-v5.md#ai-runtime-module-recovery) owns turn admission and runtime-module recovery as a consumer of this boundary. Contract text and prepared regressions are not production-rollout or browser-verification evidence; execution status stays with the owning work record or Issue.

## Read authority and recovery

A successful repository write and a confirmed current UI projection are different outcomes. If a same-owner Actual save or plan-link acknowledgement arrives after an accepted full or targeted read replaced the projection, the old Actual/material acknowledgement must not replace that newer projection. Request an Actual/StudyMaterial re-read instead.

`PlannerDataReadAuthority` owns the owner/reset epoch, accepted projection revision, full-read health, and one outstanding repair concern containing the union of three explicit groups: Actuals/StudyMaterials, MonthEvents, and Plans/Todos. `PlannerMutationReconciliation` owns only tracked local mutation activity and re-read coordination. The production hook exposes the authority's availability, recovery state, retry action, and a projection-bound freshness callback.

- A queued reconciliation concern is already non-ready. A successful targeted read clears only its own concern; it must not repair unrelated full-read failure or advance the last successful full-load timestamp. A failed or superseded full load must not advance the accepted projection revision.
- Automatic reconciliation reads only the groups requested by its immutable ticket after tracked local mutations finish repository processing and UI commit/rejection. Actuals and StudyMaterials remain one inseparable group; MonthEvents and Plans/Todos are independent requested groups. Retained Undo is tracked when invoked. If activity starts or settles during the read, discard either success or failure and re-read after quiescence. Do not reuse the full loader or claim unread collections were repaired.
- Complete fallible preparation, including sorting, for every requested group before replacing any collection. Immediately before publication, validate owner, read ticket and mutation activity. No await may separate the final check, requested replacements and authority acceptance. If one requested group fails, publish none of the batch and retain the entire union for explicit retry; this is a UI publication rule, not a claim of an atomic backend snapshot.
- Current read/preparation/publication failures remain explicitly retryable. Unrelated mutations must not repeatedly retry a latched failure. Superseded attempts cannot modify a newer ticket or prevent a newer eligible attempt from starting.
- A successful full load invalidates older targeted concerns/tickets. If a mutation was pending before or after the read, activity changed during it, or a new concern was requested, publish a new concern with the accepted projection without a transient ready state. Configure owner/scope coordination from committed React renders; an abandoned other-owner render cannot revoke the current read.

## MonthEvent completion boundary

MonthEvent save, delete and each invoked Undo capture a projection lease and tag their tracked mutation with the MonthEvent group. Successful completion records a group-local observation counter before releasing its pending ticket. If an accepted projection crossed the operation, request that group. A rejected operation adds no successful-completion observation or MonthEvent request.

Full-read entry captures those counters. Acceptance preserves requests made during the read and adds any successful groups whose counters changed. Together these triggers cover a write acknowledged after accepted refresh and a write completed before an older full snapshot is accepted. The counters describe client-observed successful completion, never durable commit order. A write already physically committed but awaiting its response can cause a redundant bounded read; payload equality or client timestamps cannot safely eliminate it.

Requests union targets; a new target supersedes the old attempt rather than discarding its other unresolved groups. One authority determines aggregate readiness. A stable successful full read can discharge older requests covered by its snapshot, but must retain new requests and successful completions crossing that read. Target success never repairs failed full-read health or advances the full-read success timestamp.

MonthEvent Undo captures its lease when invoked. After durable restore, suppress its captured row if an accepted projection replaced it; the tracked successful completion schedules the MonthEvent read. Preserve the uncontended post-persistence fast path and calendar-navigation behavior. Epoch/presence checks make repeated or old-owner settlement inert; complete bookkeeping before notifying potentially reentrant observers.

Pure Actual/material repair adds no MonthEvent getter. Rejected-only MonthEvent operations add none. Existing conservative Actual/material checks around full-read overlap remain, so a full read overlapping a successful MonthEvent operation can require both groups.

## Ordinary Plan and Todo completion

Single Plan create/edit, non-recurring move, and Todo save/delete/schedule declare the Plans/Todos repair group at the tracked callback boundary. Todo scheduling must refresh both the newly created Plan and the Todo link as one prepared publication group. A successful write crossing an accepted projection requests a fresh Plans/Todos read; a successful completion during an in-flight full read retains that same group when the older snapshot publishes. Reuse the existing writer barrier and success observations rather than replaying a removed optimistic operation or treating client completion order as durable order.

Uncontended saves keep their optimistic fast path. A rejected ordinary write does not add a successful-completion observation. A callback that only opens recurring-scope selection or declines an unsupported move has no durable effect; if it crosses a full read, callback-level tracking may conservatively add one bounded read. The later confirmed recurring mutation retains its existing admission/recovery boundary.

Repair failure leaves the saved Plan durable but its display stale and retryable. Explicit retry only reads the requested groups; it does not resubmit the save or reset the user's newer date/view selection. Owner/reset epochs revoke old callbacks and read publication. This boundary does not add backend ordering or cross-client guarantees.

## Plan Undo potential-effect boundary

Plan Undo restores a Plan, linked Actuals and an optional linked Todo. Its projection repair requests the Plans/Todos group together with Actual/material, even when that invocation has no linked Todo. It does not automatically request MonthEvents; an independently outstanding MonthEvent concern still joins the union.

After current mutation-scope, read-owner and Plan-owner admission, arm a restore-specific effect ticket immediately before repository dispatch. This is an explicit potential-effect boundary, not duplicated repository validation or a claim that a write already occurred. Repository errors after dispatch are untyped and cannot safely certify that nothing observable happened. Record settlement on both success and failure, before releasing the writer barrier. Old-epoch or duplicate settlement remains inert.

Full-read acceptance considers restores active at entry, active at acceptance, or started and settled during the read, including failure. This covers the native local ordering where full getters are queued first, Undo runs next, and awaited timetable normalization lets the old full snapshot publish after restoration. Success counters alone miss failed compensation or rejected pending overlays.

The invocation's owner and accepted-projection lease fence all captured Plan, Actual and Todo acknowledgement publication together. After an accepted replacement, suppress every captured slice and repair from current repositories. An unrelated failed or superseded read alone does not revoke that lease. A successful uncontended Undo keeps its existing fast path with no extra target reads.

Any current-owner dispatched restore failure requests the same repair union even without a full read. Preserve the failed-Undo error/notice; never label a failed restore successful, replay it, or claim compensation became atomic. The conservative cost is four getters after an untyped failure. Safe rejection before dispatch adds no restore-specific repair. Existing MonthEvent success-only tracking remains unchanged.

Retry fetches the requested groups after tracked quiescence, prepares every result before publication, and retains the whole batch as stale/retryable on any failure. It does not dispatch restore/save/progress mutations or invoke full-loader normalization. As with existing repository reads, this is not a new migration or backend atomicity guarantee. Failure recovery exposes surviving durable state; it cannot reconstruct data lost by a failed storage operation.

## Material and Subject dependent repair

Material-bearing admission requires an accepted same-owner snapshot before dispatch so uncertain failures have a valid repair boundary. A dispatched material edit/delete/Undo, progress create, or existing-member Subject fanout failure requests Actual/material repair and retains its affected admission claims. Pre-dispatch busy/stale rejection adds no such uncertain-effect repair. Writer/coordinator tickets settle normally so the repair does not wait on its own claim.

Subject data is a conditional dependent slice of that existing group. Each immutable repair attempt captures whether a waiting Subject claim requires the Subjects getter. Pure Actual/material attempts add no Subjects read. If Subject activity starts or settles while an Actual-only attempt is in flight, activity/request validation invalidates it; a fresh attempt includes Subjects. A failed Subjects getter or preparation publishes none of the batch and cannot release the Subject claim. Superseding nonquiescent full reads retain outstanding claim requirements; a stable full read already includes Subjects and can satisfy them.

This conditional footprint is not a fourth global readiness authority or a claim to have repaired every collection. Scope/owner/read checks still govern acceptance. Do not become ready with a stranded Subject claim, unconditionally add Subjects to every Actual read, or transparently replay writes after an uncertain outcome.

## User-visible recovery

The authority's owner-scoped waiting, refreshing and failed states must remain visible independently of a dismissible or expiring notification, including across ordinary App navigation. Recovery must leave existing planner data usable for inspection and preserve the AI draft and attachment.

Retry selects a full or targeted read from current authority state, coalesces duplicate activation, and never repeats the completed save/link operation. Callbacks from an old owner/reset epoch are inert. Readiness only returns when all relevant concerns have been cleared; an in-flight retry is not an acknowledgement of recovery.

## Consumer lease

Capture the owner/reset epoch and accepted projection revision with the exact arrays supplied to a planning request. Validate that captured lease against live authority readiness. A callback that checks only the latest ready state cannot validate older arrays.

Weekly admission must validate this lease before and after awaited runtime-module preflight and again after OCR before accepting a turn. A ready → non-ready → ready transition while awaiting work does not restore the old lease. Reject the retained request with a data-changed explanation, preserve exact composer text and the original attachment, and require an explicit resend using the new projection. Do not misclassify data revocation as module-load failure, or begin OCR/provider execution to recover it. Owner/chat/state lifetime and committed-input checks remain additional independent fences owned by weekly planning.

## Scope limits

Quiescence is conservative across all mutations tracked by the planner hook, while repair coverage remains limited to requested Actual/material, MonthEvent and Plans/Todos groups. Unrelated hook writes may delay repair. Activity overlapping a full or targeted read can require another read, but this cost does not buy freshness for unrequested collections.

Single Plan create/edit, non-recurring move, and Todo save/delete/schedule declare their successful Plans/Todos effects. Todo Undo still uses its existing captured-row acknowledgement and is not covered by these ordinary-writer declarations. Other untagged producers and uncertain ordinary-write failures remain outside that guarantee; do not infer whole-application coverage from these callbacks. `ready` means the authority's known full-read health and targeted concerns have cleared; it is not proof that every collection reflects all completed writes or that global concurrency recovery has finished.

This boundary handles known local read uncertainty. It does not guarantee server write ordering, acknowledgement races without an intervening accepted read, quiescence of untracked writers, multi-tab/device freshness, or no-refresh successful Plan Undo command-order races. It does not cancel or revalidate an already admitted turn, invalidate an existing preview, or replace server idempotency/authorization, durable sync or optimistic rollback policy.

## Verification boundary

- Authority/coordinator/hook tests must distinguish durable write success from recovery failure, prove target-union retention, selective getter costs, both full-read/completion orders, mutation quiescence and atomic publication, and reject superseded owner/read callbacks. Preserve recurrence metadata and calendar selection across MonthEvent save/delete/Undo in both repository representations. Plan Undo tests additionally cover native public-facade full-read overlap, optional dependents, dispatched failure without a full read, failed compensation, both union settlement orders, and preservation of the original failed-Undo notice.
- Application/component tests must reject revoked collection leases before and after module preflight and OCR, including recovery to ready before the old await completes, while preserving draft/attachment and preventing turn/provider admission.
- [The full-App recovery browser specification](../../../../tests/e2e/planner-reconciliation-recovery.spec.mjs) uses the real hook, authority, application/controller and local repository writes. Gates surround external acknowledgement/read/OCR boundaries; runtime execution output may be stubbed. Runtime-module preflight imports the actual module, with an explicit network gate for load-order races. Static/syntax checks alone do not establish any browser scenario as passing.
- [The production module-recovery browser specification](../../../../tests/e2e/weekly-planning-module-recovery.spec.mjs) separately covers actual built-module MIME failure and explicit reload/capsule behavior. Keep it intact when adapting the reconciliation harness; it is not replaced by the execution stub.
