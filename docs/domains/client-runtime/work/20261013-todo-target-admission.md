# Todo target admission

Status: active, local-only investigation under Issue #437
Base: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`
Branch: `fix/todo-target-admission`
PR: none; remote writes remain blocked and are not attempted.

## Ownership and scope

Fresh GitHub reads on 2026-10-13 confirmed this main, all open pull requests,
all remote branch names and the latest Issue #437 comments. Prior Todo read
reconciliation (#469/#470) and local optimistic rollback (#384) are merged;
no active owner of stale Todo command targets was found. This local task owns
Todo command admission in the planner hook and its focused regressions.
AI, weekly planning, server write ordering and cross-client synchronization
are outside scope.

## Investigation

A submitted existing Todo ID currently falls back to new creation when absent
from the captured collection. Scheduling also carries the original Todo object.
This is a code finding, not yet an executed reproduction.

Competing explanations to test:
1. The UI always retires an editor after a fresh read, making the path unreachable.
   TodoView retains its editing/scheduling object across prop refreshes, so the
   real hook remains a relevant admission boundary.
2. Only the latest render is unsafe. Retained callbacks may also see old arrays;
   reproduce both before selecting the authoritative lookup mechanism.
3. The repository rejects missing targets. Exercise the actual local repository
   to establish whether a stale command can create or resurrect durable rows.

Next: reproduce missing/current/retained targets with real hook + local adapter,
then make the smallest verified correction. A new Todo without an edit ID must
remain supported. Preserve owner/reset lifetimes and existing reconciliation.

## Completion condition

Reproduction, targeted regression, exact diff review, fresh final npm run verify,
and scoped documentation must be complete for a locally verified candidate.
Remote publication, CI and browser acceptance are separate, blocked gates; no
production/provider traffic is authorized by this local task.

## Reproduction and local correction

The unchanged main failed all eight new real-hook/local-repository cases:
edit/schedule/delete after an accepted deletion, each through current and retained
callbacks, plus edit/schedule during a pending deletion. Actual persisted rows
showed resurrection/new creation and a Plan left after its Todo was deleted.

The correction resolves existing command targets from committed same-owner Todo
rows and synchronously reserves that ID before dispatch. Only committed React
publication after settlement releases the reservation, including rollback and
synchronous preparation failures. New creation without an edit ID remains
available; unrelated Todos can proceed independently. Admission errors use the
existing user-visible notice. Scheduling and delete Undo retain current Todo
metadata rather than the earlier captured row.

This covers only these three local commands. It does not claim general stale
edit-content conflict detection, server atomicity, multi-device ordering, or
coverage of every linked-Plan/Undo producer. Existing reconciliation and compound
repository contracts remain unchanged. Issue #437 stays open.

## Verification before final freeze

- Baseline: eight failed cases, genuine persisted-state/dispatch assertions.
- Focused: six files / 162 passed, including 29 new controls; natural exit 0.
- App development typecheck: exit 0 after correcting new test wrapper return types.
- Parent independent review: synchronous pre-dispatch throw release was corrected;
  no remaining blocker found for this narrow slice.
- Final fresh app/Worker types, full default test suite and build: pending.
- No lint script is configured. Browser/remote CI and production acceptance remain
  unverified; no provider or production traffic has been sent.

The ordinary focused run included Todo read recovery, planner data state,
rollback isolation, optimistic state and TodoView pending operations. Initial
control-fixture errors (canonical null/false normalization and invalid duplicate
cross-owner IDs) were fixed against actual repository reads. Existing production
assertions and test thresholds were not weakened.


## Independent review and corrected read boundary

First frozen tree `1125dae31a5d4bdf7086d08900e618f7acae6555` passed fresh
app/Worker types but its full suite ended with 7,245 passed / seven failed,
45 skipped / one todo; build was not reached. The seven failures shared the
navigation fixture's fabricated Todo rows, supplied to the view but never loaded
into the hook. The fixture now seeds the same independent records through the
canonical loader and supplies the view with hook state. All original navigation
assertions, success/failure order combinations and timeouts remain intact.

Independent source review also found a genuine remaining defect: a full read can
republish a Todo while deletion is pending. After deletion settles, a pending or
failed repair still leaves that obsolete row visible. All 12 current/retained ×
edit/schedule/delete × pending/failed-repair probes detected a new durable write.
The local command boundary now binds committed rows to their committed projection
lease and asks the existing read authority about Plans/Todos uncertainty. It
preserves ordinary clean-full-refresh overlap and unrelated repair groups.

An additional direct authority failure showed that beginning retry after a failed
full read prematurely restored mutation admission. An authority-owned failure fact
now survives retry until successful full acceptance or owner/reset. Six actual
hook/local-persistence tests preserve deleted durable rows throughout that retry.
This does not add a separate readiness authority or infer backend write order.

Corrected regression: 54 Todo command cases, including the independent 19-case
read matrix. The earlier ten-file run passed 258 cases before the six full-retry
controls; the corrected three-file run passed 83 cases. These focused counts are
separate scopes, not additive full-suite evidence. Final independent review passed 30 probes on the corrected production bytes,
including five concurrent/epoch boundaries; no blocker remained in this local
scope. Final corrected full verification remains pending at this checkpoint.

## Final local result

Exact frozen source tree `154671b68bbb5e20dd756bc11fe362b379c7b0ca` passed:

- `WRANGLER_SEND_METRICS=false DEV_LAN_HOST=127.0.0.1 npm run verify`, exit 0
- Fresh non-incremental app and Worker types, including Worker type regeneration
- 813 passing files / 7,282 passed tests; 10 skipped files / 45 skipped tests and
  one todo are not passes
- Production build, 4.83 seconds
- Independent final 30-case review, exit 0; all three production SHA-256 values
  matched the reviewed bytes before final reporting
- All 2,369 tracked/untracked source inputs, 235 installed package identities,
  101 absent platform/optional lock entries, Node 24.19.0, npm and recorded
  verification environment values were identical before/after; no installed
  package version mismatches

This final result supersedes the earlier failed full run for corrected content.
The final checkpoint append is documentation-only and does not change the
verified code/test/configuration/dependency input bytes.

### Remaining release blocker: existing bundle ceiling

The separate `node scripts/ci/check-bundle-budget.mjs` gate exited 1 for aggregate
JavaScript raw/gzip size. A fresh build of unchanged main `819d5bac` with the same
installed dependencies and lockfile also fails both limits. All 2,366 exported
baseline files match their Git blobs exactly.

- Existing limits: 2,265,000 raw / 610,000 gzip bytes
- Unchanged main: 2,340,326 raw / 630,385 gzip bytes
- Candidate: 2,342,195 raw / 630,942 gzip bytes
- Attributable candidate increase: 1,869 raw / 557 gzip bytes
- CSS metrics are identical; the other eight budget checks remain within limits

No threshold, assertion, workflow or skip was changed to conceal this failure.
Its shared baseline correction is outside this bounded Todo task. The local
implementation and mandatory verify are complete; this is not an all-gates-green
release candidate. Browser/remote CI and publication remain unverified/blocked.
No remote Issue, branch or PR was created or updated; no branch was deleted. The
local branch is retained for the existing Issue #437, which remains open.
