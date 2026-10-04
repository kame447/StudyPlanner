# Planner read projection recovery

Status: supporting architecture contract
Updated: 2026-10-05
Parent: [Client-first execution requirements](../spec/client-first-execution-requirements.md)

This document owns the local planner read-freshness and recovery boundary under the parent requirement's account isolation and user-visible status rules (DATA-004 / OFF-004). It does not redefine durable storage, server synchronization, or the optimistic rollback requirements in SYNC-007. [Weekly planning](../../weekly-planning/architecture/current-contract-v5.md#ai-runtime-module-recovery) owns turn admission and runtime-module recovery as a consumer of this boundary. Contract text and prepared regressions are not production-rollout or browser-verification evidence; execution status stays with the owning work record or Issue.

## Read authority and recovery

A successful repository write and a confirmed current UI projection are different outcomes. If a same-owner Actual save or plan-link acknowledgement arrives after an accepted full or targeted read replaced the projection, the old Actual/material acknowledgement must not replace that newer projection. Request an Actual/StudyMaterial re-read instead.

`PlannerDataReadAuthority` owns the owner/reset epoch, accepted projection revision, full-read health, and outstanding Actual/material concern. `PlannerMutationReconciliation` owns only tracked local mutation activity and re-read coordination. The production hook exposes the authority's availability, recovery state, retry action, and a projection-bound freshness callback.

- A queued reconciliation concern is already non-ready. A successful targeted read clears only its own concern; it must not repair unrelated full-read failure or advance the last successful full-load timestamp. A failed or superseded full load must not advance the accepted projection revision.
- Automatic reconciliation reads only Actuals and StudyMaterials after tracked local mutations finish repository processing and UI commit/rejection. Retained Undo is tracked when invoked. If activity starts or settles during the read, discard either success or failure and re-read after quiescence. Do not reuse the full loader or claim unread collections were repaired.
- Complete fallible preparation, including any required sorting, for both collections, before replacing either collection. Immediately before publication, validate owner, read ticket and mutation activity. No await may separate the final check, both replacements and authority acceptance.
- Current read/preparation/publication failures remain explicitly retryable. Unrelated mutations must not repeatedly retry a latched failure. Superseded attempts cannot modify a newer ticket or prevent a newer eligible attempt from starting.
- A successful full load invalidates older targeted concerns/tickets. If a mutation was pending before or after the read, activity changed during it, or a new concern was requested, publish a new concern with the accepted projection without a transient ready state. Configure owner/scope coordination from committed React renders; an abandoned other-owner render cannot revoke the current read.

## User-visible recovery

The authority's owner-scoped waiting, refreshing and failed states must remain visible independently of a dismissible or expiring notification, including across ordinary App navigation. Recovery must leave existing planner data usable for inspection and preserve the AI draft and attachment.

Retry selects a full or targeted read from current authority state, coalesces duplicate activation, and never repeats the completed save/link operation. Callbacks from an old owner/reset epoch are inert. Readiness only returns when all relevant concerns have been cleared; an in-flight retry is not an acknowledgement of recovery.

## Consumer lease

Capture the owner/reset epoch and accepted projection revision with the exact arrays supplied to a planning request. Validate that captured lease against live authority readiness. A callback that checks only the latest ready state cannot validate older arrays.

Weekly admission must validate this lease before and after awaited runtime-module preflight and again after OCR before accepting a turn. A ready → non-ready → ready transition while awaiting work does not restore the old lease. Reject the retained request with a data-changed explanation, preserve exact composer text and the original attachment, and require an explicit resend using the new projection. Do not misclassify data revocation as module-load failure, or begin OCR/provider execution to recover it. Owner/chat/state lifetime and committed-input checks remain additional independent fences owned by weekly planning.

## Scope limits

Quiescence is conservative across all mutations tracked by the planner hook, while repair coverage remains narrow: only Actuals and StudyMaterials are fetched. Unrelated hook writes may delay that repair, and activity overlapping a full or targeted read may require another pair of Actual/material RPCs. This wait/read cost does not buy freshness for the other collections.

In particular, a successful MonthEvent or Plan write acknowledged after an accepted full refresh is not repaired by this targeted pair. The new row can remain absent from the displayed non-target collection even after the Actual/material concern clears and readiness returns. `ready` means the authority's known full-read health and targeted concerns have cleared; it is not proof that every displayed collection reflects all completed writes or that global projection/concurrency recovery has finished.

This boundary handles known local read uncertainty. It does not guarantee server write ordering, acknowledgement races without an intervening accepted read, quiescence of untracked writers, multi-tab/device freshness, or Plan Undo acknowledgement re-adoption. It does not cancel or revalidate an already admitted turn, invalidate an existing preview, or replace server idempotency/authorization, durable sync or optimistic rollback policy.

## Verification boundary

- Authority/coordinator/hook tests must distinguish durable write success from recovery failure, prove mutation quiescence and atomic publication, and reject superseded owner/read callbacks.
- Application/component tests must reject revoked collection leases before and after module preflight and OCR, including recovery to ready before the old await completes, while preserving draft/attachment and preventing turn/provider admission.
- [The full-App recovery browser specification](../../../../tests/e2e/planner-reconciliation-recovery.spec.mjs) uses the real hook, authority, application/controller and local repository writes. Gates surround external acknowledgement/read/OCR boundaries; runtime execution output may be stubbed. Runtime-module preflight imports the actual module, with an explicit network gate for load-order races. Static/syntax checks alone do not establish any browser scenario as passing.
- [The production module-recovery browser specification](../../../../tests/e2e/weekly-planning-module-recovery.spec.mjs) separately covers actual built-module MIME failure and explicit reload/capsule behavior. Keep it intact when adapting the reconciliation harness; it is not replaced by the execution stub.
