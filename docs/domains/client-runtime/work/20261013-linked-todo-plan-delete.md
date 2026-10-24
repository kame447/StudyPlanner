# Linked Todo admission for normal Plan deletion

Status: independently reviewed candidate under Issue #437; full/native acceptance pending
Branch: `fix/issue437-linked-todo-plan-delete`
Initial base: `c1f10455323f7d1a4834a7ece18fd3eb073f8820`
Integrated main: `c32b0e27844453ffa800a6e4c733c009c2864ed5` (normal merge, no conflicts)

## Ownership and bounded change

Fresh Issue, PR and all 122 remote-branch reads found no active owner of this
slice. Merged #600 explicitly left linked Plan/Undo writers outside its scope.
This change covers normal Plan deletion only. Recurring delete and Undo writer
policy, schemas, Firestore Rules, server ordering and multi-client atomicity
remain unchanged. Issue #437 stays open. Main integration belongs to the release
coordinator; this branch does not merge itself.

## Reproduction

The existing real-hook/Firebase-adapter integration harness pauses the Actual
query inside normal Plan deletion. While it is paused, the linked Todo edit or
delete is accepted. Releasing the query then commits the captured Todo in the
Plan-delete batch: the newer title is overwritten, or the deleted Todo is
recreated. Both added cases failed on the unchanged base; all four existing
cases passed. This is controlled SDK storage, not production Firestore evidence.

Rejected alternatives:

- Existing Actual/Plan reservation alone: baseline reproduction proves Todo
  operations are outside those keys.
- Re-read after the query: another write could still cross that read and batch;
  this would not provide the required same-client admission boundary.
- New transaction/schema/order framework: unnecessarily broad for the proven
  same-owner local-command race and would imply unverified cross-client policy.

The normal deletion now uses the existing Todo admission and its current
committed owner/read projection. It reserves a matching Todo before optimistic
projection or persistence, and keeps the reservation until committed settlement.
A pending Todo deletion is checked before absence, so optimistic removal cannot
bypass the reservation. A settled missing or reassigned Todo is not written.
Latest committed Todo metadata is used even by retained Plan-delete callbacks.
Both reservation lifetimes include preparation, success, rollback and errors.

## Verification checkpoint

- Baseline: two persisted-state regressions failed, four existing cases passed.
- Focused: 185 tests in seven existing admission suites passed; 14 cases belong
  to the Firebase integration file, including ten new cases.
- New controls cover both start orders, pending/failed query completion, retry,
  held concurrent React publication, latest metadata, reassignment, unrelated
  Todo, owner replacement, and pending/failed crossing-read repair.
- Initial new control failures were harness-contract errors: a legacy React
  root committed before the supposed prepublication assertion, and an expired
  owner callback is correctly rejected. The publication tests now use a
  concurrent root and the owner test asserts that rejection. Product assertions
  and existing tests were not weakened.
- Integrated hook regressions: 25 files / 747 tests passed on the combined
  current-main candidate. Independent review: no blocker, 136 tests and two
  extra preparation-failure / optimistic-reassignment probes passed.
- Initial app type feedback found the test-only concurrent renderer options
  omitted the required createNodeMock type field; it is now supplied. Final
  exact-input fresh types/full tests/build are pending. Native CI remains required; known local Chromium startup EPERM is
  not retried or reported as a browser pass. No live data is used.

## Completion condition

Exact-content full verification, independent review, coherent feature-only diff,
and relevant native CI must be established before adoption. Record the published
head, terminal results and any inherited gate failures in Issue #437. No new
credentials, resources, production data or branch deletions are part of this work.

## Final local verification

Full-verified HEAD `b967cb58c985d3cfa22f553103a86ac1cc0ce0d5`, tree
`73dff8825eaa03db56d80e127ec20d5aa34e462e`, includes main `c32b0e27`.
`npm run verify` exited 0 with fresh non-incremental app/Worker types, 868
passing files / 8,243 passed tests (54 skipped / one todo separately), and a
production build in 4.95 seconds. Explicit environment was
`WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 DEV_LAN_HOST=127.0.0.1
VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1`; no verification threshold was changed.

Tracked source bytes, installed dependencies (19,305 files), generated Worker
runtime, lockfile, tools and recorded environment matched before/after. The
existing compatibility test generated 218 untracked output files: 217 are
byte-identical to immutable Git revision `070d25cbe14796aebb8168ac5425c93e3506df1c`,
plus its generated bundle. They were preserved separately from the worktree;
no product inputs were removed or changed. Initial raw status mismatch is thus
classified explicitly, rather than treating generated output as an input change.
The later checkpoint update is documentation-only.

The separate bundle gate still fails six categories inherited from current main:
JavaScript total raw/gzip and CSS total/largest raw/gzip. Candidate JavaScript is
2,381,747 raw / 643,138 gzip bytes. No budgets or runtime tests were relaxed.
Native CI and release adoption are still separate pending gates.
