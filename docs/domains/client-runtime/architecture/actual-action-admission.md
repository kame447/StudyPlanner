# Actual action admission

Status: supporting architecture contract
Updated: 2026-10-05
Parent: [Client-first execution requirements](../spec/client-first-execution-requirements.md)

This boundary prevents conflicting same-owner UI operations from being admitted through different screens while an Actual or participating Plan mutation is unresolved. It is a busy/reopen contract, not a queue of future user intents, persistent identity registry, server revision protocol, or replacement for [read projection recovery](planner-read-projection-recovery.md). Issue #437 owns execution evidence and remaining ordering work.

## Demonstrated user path

Quick Entry can close while a linked Actual save is waiting for the Firebase adapter's occurrence query. Its optimistic record remains visible in Day view. A new editor has a fresh component-local pending ref and could delete it successfully before the original save batch recreated the same ID. Plan deletion from the day action sheet could likewise leave a later orphan Actual. Controlled real-component/adapter tests demonstrate those source contracts; they are not live Firebase incidence measurements.

Component-local submit guards remain useful but do not own cross-surface admission. `useActualMutationAdmission`, owned by the planner data hook, holds synchronous owner/scope-bound claims before optimistic publication or repository dispatch. Rendered status is derived from those claims; there is no second read-health authority.

## Keys and callers

- Existing records claim the owner-scoped Actual ID and their linked source occurrence when present
- Linked creation claims its owner/Plan/date occurrence and new provisional ID; two stale empty-render submissions cannot both reserve that occurrence
- Link/move claims the source ID/source occurrence and its declared destination occurrence. Different standalone IDs and disjoint linked occurrences remain usable
- Plan deletion, invoked Undo, and recurrence mutations affecting Actuals take Plan-wide claims for their affected IDs. Those conflict with the Plan's occurrence claims in both directions, but do not serialize unrelated Plans
- Record opening checks current busy/stale status so an unresolved optimistic record cannot seed a new immutable editor capture. Shared dispatch checks remain the invariant even if a callback or editor was already retained
- Explicit target IDs are resolved against committed current owner records. A disappeared/replaced ID rejects; it never becomes an implicit create, successful no-op delete, or guessed canonical alias. Preserve the draft and ask the user to reopen the current record
- Linked targets must be current owner Plans or supported MonthEvent-backed record targets; do not invalidate legitimate synthetic record targets merely because they are not stored as Plans

Claims use scope identity as well as owner identity. Reset, logout or a replacement scope cannot have its reservations released by an older finally callback.

## Settlement and trustworthy publication

An ordinary successful acknowledgement or rollback releases admission only after its resulting projection has committed in React. This closes the gap between repository settlement and canonical-ID publication without overwriting immutable editor drafts.

A read may cross a mutation in either direction: it may accept before the writer settles, or it may still be loading when the writer settles and accept an older snapshot later. A centralized finally rule handles both success and rejection. Resolve current owner read state from the canonical read authority; request the affected repair groups and retain that claim until a trustworthy publication for those groups commits.

The writer promise and mutation-coordinator ticket still settle immediately. A claim awaiting repair must not hold the same quiescence barrier that its own repair needs. A failed repair leaves only affected claimed targets blocked with an explicit refresh/retry explanation. A successful unrelated group read cannot unlock them.

When a superseding full read is nonquiescent, carry outstanding claim-required groups into the authority's concern. Do not let the authority become ready with a permanently stranded Plan claim whose required group was dropped. A stable full snapshot may satisfy the applicable claims. Claims request evidence from the authority; they do not independently certify global readiness.

Retained full-load callbacks resolve the current admission object from a layout-committed owner/scope reference after normal read-token checks. Do not capture a revoked admission map or update that reference during an abandoned render. Keep the loader's baseline-stable identity so claim/scope changes do not restart authentication bootstrap.

## User-facing behavior

Conflicting actions reject with a busy or stale-target explanation; they are not silently queued, retargeted or reported successful. Existing editors retain their input after rejection. Pending record-open actions are disabled or explain why the record cannot yet be opened. Reopen after completion or successful data retry to capture the current record.

This does not forbid closing the originating view, globally freeze unrelated editing, or replace existing per-editor duplicate-submit/immutable-draft protection. Repository validation remains at its existing boundary.

## Explicit limits

Shared material-progress writes are not reserved by these Actual/occurrence/Plan keys. Distinct Actuals using the same material can still race absolute progress payloads; Issue #456 separately tracks a controlled Study Session/Firebase-adapter reproduction. “Different records are allowed” must not be read as universal write-set isolation.

Untracked writers, other clients/tabs, stale external content, backend transaction/compensation atomicity, ordinary Plan producers outside the participating paths and transparent queued intent preservation are not established. The [local storage queue](local-planner-storage-access.md) has its own exact-module/exact-Storage-object scope. Neither boundary repairs data already lost by a different writer or failed compensation.

## Verification contract

Keep real component/query-window controls, successful settle/reopen/delete, stale provisional-to-canonical targets, source/destination and Plan-wide conflicts, disjoint access, failed repair/retry, both full-read timing directions, superseding reads, retained loaders, owner/reset, abandoned renders and authentication bootstrap counts. Preserve the original linked/standalone editor recovery assertions.

Old same-record-overlap tests must explicitly map to the new busy/retry contract. Preserve their independent read/rollback invariants with disjoint-record schedules where appropriate; do not simply remove assertions to obtain a pass. Case labels and inner schedule executions are distinct counts. Browser pre-dispatch holds are remote-latency stand-ins, not live Firebase or native-local scheduling evidence.
