# Admin Users integration

Status: active, local integration candidate; no remote publication authorized
Owning Issues: #213 (contract), #542 (read reduction)
Branch: `fix/admin-users-integration`
Base: `780bec4a14b1b5edc584a2eb348ba0af8bbeeb25`
Initial integration HEAD: `3cfb18d445f54fa59b4f22d679523d26049edf92`
PR: none

## Scope and ownership

Integrate the frozen identity-search patch `c9b17fb0593c293d1d1754380e6ade84a0bcda53`
and page-only service patch `ff0f11ec584f761aae44750927fb0a3160365b1d` on current main.
The source branches and worktrees are preserved. Both immutable patches applied
without conflicts. The only additional runtime change is the Users component's
page-only import and Load More call; initial loading retains its existing API.

Fresh remote main, Issues #213/#542 with comments, open PRs, historical admin PRs,
and all matching remote branches were inspected. PR #605 owns the separate
user-detail timeline, and #599 owns event ingestion. Neither overlaps this
integration. A dedicated local integration branch is needed to preserve the two
frozen source branches while validating their combined current-main content.
No new Issue, PR, remote branch, main edit, deployment or branch deletion.

## Acceptance and next action

- Keep the current-query identity owner and request token unchanged.
- Initial legacy load retains its fallback Overview and initial trend.
- Load More calls the explicit page API; one legacy Overview request is removed
  per additional page. Current Worker request counts and integrated trend work
  are unchanged. No Firestore billing or production performance claim.
- Preserve authentication, response validation, errors, retry, cursors and loading.
- Add focused real-component/real-service regressions with synthetic HTTP.
- Freeze the final input snapshot for independent review, then run one final
  `npm run verify` with source, installed dependency and environment identities.
- Keep browser/visual, remote CI and live admin behavior explicitly unverified
  unless separately measured. No test-infrastructure or dependency changes.

Next: add the connection regression, make the two-line caller integration,
run focused tests, then freeze for independent review and full verification.

## Focused integration checkpoint

The two-line caller connection is complete. The new component/service test uses
real service functions and synthetic authenticated HTTP. Before connecting the
caller, it failed 3 of 4 cases (missing page API invocation and duplicate legacy
Overview); after connecting it, all 4 passed. It checks explicit Users/Overview
counts, the retained initial trend, loading state, terminal cursor, failure and
retry on the same cursor, identity input preservation and no identity data in
browser history. Existing identity ownership and server authorization tests are
unchanged.

`DEV_LAN_HOST=127.0.0.1 npm run test:run --
src/components/AdminUsersPage.pagination.test.tsx
src/components/AdminUsersPage.requestOrder.test.tsx
src/components/AdminUsersPage.test.tsx src/hooks/useAdminData.test.tsx
src/components/AdminApp.test.tsx
src/services/adminObservabilityService.usersPage.test.ts
src/services/adminObservabilityTraceEvidence.test.ts
workers/ai-proxy/src/productObservabilityApi.test.ts`: exit 0, 75 tests / 8 files.
`git diff --check`: exit 0. Logs retained in the local sibling directory
`admin-users-integration-evidence-20261013`.

Parent is merging the separately approved existing eight-PR stack into main.
Do not run final full verification yet: wait for the parent's final main SHA,
integrate it on this same branch, inspect the resulting exact diff and inputs,
then run one full verify. Independent reviewer owns external read-only probes;
no source/test mutation is permitted during the final verify.

## Final verification input freeze

The parent completed the approved main stack. A fresh remote read and exact-SHA
fetch confirmed main `8de4794a9f5d0437cffef66c28acacab7a86338a`, tree
`0745b74f5f7842334308040065770e2f10fa1495`. It was merged into this local branch
without conflicts as `5fad12ef1ba225abdc5f9319fcea210e133e8dc9`. The base update
changed none of the Users component, admin service, initial-loading hook,
existing Users test, app package/lockfile or Vite config. The main delta is
inherited, not new work in this candidate.

The candidate delta against that final main remains nine files: the immutable
source patches plus the two-line caller connection, new pagination test and
this checkpoint. Both original source branches remain clean at their supplied
commits. No Worker, shared type, AI, planner, dependency or test-infrastructure
change is introduced relative to final main. No lint script is configured.

Independent external review found no blocker. Four component/service probes
passed for current/current, legacy/legacy and both mixed response sequences,
including overlapping identity searches, filter edits and a pending page.
The pre-connection legacy control failed the duplicate Overview assertion.
The review is retained at `/workspace/shared/admin-users-review-20261013/review.md`.

Final full command: `npm run verify` with `DEV_LAN_HOST=127.0.0.1`,
`CLOUDFLARE_CF_FETCH_ENABLED=false`, `VITEST_MAX_FORKS=2`, `VITEST_MIN_FORKS=1`.
Worker types are materialized before and regenerated during fresh checking.
The local evidence directory contains `verify.log`, `verify.exit`, pre/post
tracked source and installed-file identities, generated-input hashes and a
final receipt. Do not claim this command passed until its exit and identity
comparison have been checked. No input edits are allowed during that run.

The same-content main build is already available from the parent's detached
integration (tree `0745b74f5f7842334308040065770e2f10fa1495`). Its HEAD is different;
reuse is based on tree and installed-input equivalence only. Separate bundle
budget comparison must report the inherited aggregate JavaScript failures
without changing thresholds. Browser/visual, emulator, remote CI and live
admin verification remain separate, unrun stages for this local candidate.

## Stable e44 main integration — 2026-10-13

Parent authorized a new local integration check after main stabilized at
`e44f4b4154608a4ebd41399b8f41d6f6dce7431c` (tree
`c94d41a14c0c20f1ad1d9102ea3b2f3b176994cc`). Fresh remote main and exact-SHA
fetch matched. Existing Issues and remote branches/PRs were rechecked; the
same local candidate branch is reused, with publication still awaiting approval.

The old verified candidate `df874c3781f5d54eedc8eac45f7d7a448d2424ac` and its
8de-based receipt remain unchanged and retained. A normal local merge produced
`6358fcb0cd283705fa64cc4837a2601a9e7687d6`. All 28 files introduced by main's
PR #596 are byte-identical to main, with no candidate overlap. They include
shared AI/model configuration, so the previous 7,663-test full pass is not
reused as proof for this new combined snapshot. No AI code is edited here.
The Admin Users component/service and three focused test files are unchanged.

Run one new final `npm run verify` for this input snapshot using the same
recorded toolchain and bounded worker settings. The new evidence directory is
`admin-users-e44-integration-evidence-20261013`; it holds its own source,
installed-file, generated-input identities and new `receipt.json`. The prior
evidence directory is not overwritten. Independent review should reconcile
this new base without duplicating the full run. Existing budget failures are
to be checked against exact-main CI logs or previously built/published assets;
do not build the same baseline again merely for this comparison.

Next: freeze this documented snapshot, run its single full verify, verify
pre/post identity stability and classify bundle deltas, then report the local
candidate. Browser/remote CI/publication remain separate; no push, PR, main
write or deployment is authorized by this local refresh.
