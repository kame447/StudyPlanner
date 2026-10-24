# Admin Users pagination read scope

Status: active, local implementation only
Owning Issue: #542; contract owner: #213
Branch: `perf/admin-users-pagination-reads`
Base: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`

## Scope and ownership

The Users screen retains its initial trend when appending another page. The
legacy-Worker compatibility path currently fetches a 30-day Overview for that
additional page even though the caller discards the returned trend. Add an
explicit page-only service API without changing the initial-loading contract.

On 2026-10-13, current main, Issue #542 and its four comments, Issue #213,
closed Issues #307/#308, merged PR #313, open PRs and remote branch names were
checked. No active implementation owns this service pagination change.
PR #599 owns event ingestion; PR #605 owns user-detail history; neither is
changed here. A separate local identity-search task owns `AdminUsersPage.tsx`.
This branch therefore leaves that component untouched. The integration owner
will connect the page-only API at its existing load-more call site after the
two independent commits are available.

## Contract

- Initial load still fetches one fallback Overview for a legacy successful
  Users response and uses a current response's validated integrated trend.
- Page-only load always performs the authenticated Users request. It returns
  users, cursor and enrichment readiness, without claiming a trend snapshot.
- Current response shape is still validated; malformed nested trend and
  failed/auth-denied Users responses never fall back to Overview.
- No persistent/shared cache, TTL, authorization, Worker, planner history,
  recurrence, profile recovery or Firestore Rules changes.
- Savings apply only to legacy-Worker page requests. A current Worker still
  computes its integrated trend; this branch makes no claim to reduce those
  Firestore reads or production billing.

## Candidate comparison

1. Reuse an initial trend through an implicit service cache: rejected because
   ownership, environment and freshness would become implicit.
2. Change the Worker pagination response: broader mixed-version API change,
   unnecessary for the verified legacy fallback waste.
3. An explicit page-only client API: narrowest observable request reduction;
   preserves existing callers and validates the same response contract.

Other inspected planner reads were startup/projection recovery or recurrence
dependency reads. Normal recurring mutation construction did not confirm the
apparent full-plan/occurrence overlap, so those paths are unchanged.

## Local service checkpoint

The page-only `getAdminObservabilityUsersPage` API is implemented. Shared request
and response normalization preserves the existing initial-loading API. Its
return type intentionally has no trend field; it does not fabricate an empty
trend or establish a cross-request cache.

Mock HTTP measurement uses the real client service and synthetic payloads:

- Initial load plus one page, legacy Worker: 4 requests (2 Users, 2 Overview)
  before; 3 requests (2 Users, 1 Overview) with the explicit page API.
- Current Worker: 2 Users requests, 0 Overview requests before and after.
- Each additional legacy page removes one Overview request. No saved-read or
  billing count is claimed; production Firestore was not queried.

Focused verification: 37 tests in 3 files passed, including 29 new service
tests. Fresh `npm run typecheck:app:full` passed. A fallback-reintroduction
mutation caused 4 failures; restoring the exact verified service hash restored
37 passing tests. The first app typecheck caught an unsupported `Array.at` in
the test harness; it was replaced by indexing without changing tsconfig.

The final focused/typecheck input snapshot held 2,368 source inputs and 235
installed package entries on Node 24.19.0; input/package/tool identities matched
before and after. [Receipt](evidence/20261013-admin-users-pagination-reads/receipt.json)
records source hashes, command scopes and boundaries. Raw baseline, mutation,
focused logs and identity snapshots are retained locally under the ignored
`artifacts/admin-users-pagination-reads/` directory.

Main advanced to `780bec4a14b1b5edc584a2eb348ba0af8bbeeb25` while this isolated
branch remained based on `819d5bac`. Direct exact-commit inspection found no
changes to the relevant client service, Users component, Worker admin API or
read model. This is contract inspection, not a new-base integration proof.

## Integration still required

This service-only commit has no production caller yet. The integration owner
must add `getAdminObservabilityUsersPage` to the existing import in
`AdminUsersPage.tsx` and call it only from `loadMore`; the initial `loadUsers`
call must remain `getAdminObservabilityUsers`. The identity-search task owns
that component until its separate commit is frozen.

Next: connect those two lines, verify rendered pagination and preserved initial
trend under old/current Worker responses, then run final full verification on
the combined current-main content. No full `npm run verify`, browser pass,
remote push, PR, Issue write, main change or deployment is claimed here.
