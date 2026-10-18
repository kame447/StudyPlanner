# Admin user timeline request ownership

Status: active, local implementation only
Owning Issue: #213
Branch: `fix/admin-user-timeline-ownership`
Base and initial HEAD: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`
PR: none

## Scope and ownership

The admin user investigation page must display only the selected actor's first page and continuation pages. A route change must discard prior actor pages, cursor, errors and loading state. Continuation requests must be admitted once per successful cursor, with retry available after failure. Responses and retained callbacks from an unmounted actor page must not affect its replacement.

The 2026-10-13 GitHub preflight verified Issue #213 open, current main at the base above, all 21 open PRs and all 85 branches. No active user-investigation pagination owner was found. Merged PR #395 fixed Admin Logs request ordering only. PR #599 owns backend event ingestion and is separate. No AI, scheduler, auth policy, shared loader, API, metrics, persistence, CSS, Docker, test infrastructure or other worker's source is included.

## Evidence and approach

The current route reuses `AdminUserDetailPage` for different actor IDs. Its initial loader cleans up asynchronous results, but retains its prior data until the next success. Additional timeline, cursor, error and busy state have no actor lifetime. Continuation uses state-only locking, allowing same-tick duplicates, and applies success/error/finally unconditionally.

Compared: share duplicated metric formatting; share admin query construction; fix actor-owned pagination. The first two do not demonstrate a user-visible defect. The third has direct deferred-response tests and a small component-local boundary. A keyed internal actor page can reset every related state together, while the existing ref-based request ownership pattern prevents duplicate or obsolete callbacks. No shared framework is needed.

## Definition of done and next action

1. Reproduce current defects with component tests before production edits.
2. Preserve normal first page, pagination, failure and retry behavior.
3. Verify actor switch, late success/error/finally, retained callbacks, completed cursors and duplicate clicks.
4. Supply focused tests and exact diff to integration owner; full verification, review and publication remain with that owner.

Next: write focused red tests on unchanged production code.

## Local implementation verification — 2026-10-13

Implementation is limited to `AdminUserDetailPage.tsx`: a keyed actor-owned inner component shares the first-page and continuation lifetime; a synchronous ref/token owns each continuation; completed cursors cannot be replayed; failure leaves the cursor retryable. Layout cleanup revokes both retained callbacks and pending completions when the route changes or the existing AdminGuard removes the page. No markup, labels, styles, aggregation or request shape changed.

- Baseline: 12 deferred-request cases against unchanged main production bytes yielded **9 failures / 3 passes**. Failures included retained actor data, inherited busy/error state, late A results on A→B→A, duplicate same-tick requests and replayed cursors.
- Final focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/AdminUserDetailPage.requestOrder.test.tsx src/components/AdminUsersPage.test.tsx src/components/AdminLogsPage.requestOrder.test.tsx src/hooks/useAdminData.test.tsx src/components/AdminApp.test.tsx src/lib/adminRoutes.test.ts` — **exit 0, 6 files / 50 tests passed**. The 14 new cases include auth-guard checking/denied transitions, normal page order, first-page ownership, continuation failure/retry and unmount.
- `npm run typecheck:app` — exit 0, app TypeScript feedback. Worker/full typechecks, full suite, build and browser/visual tests were not run by this implementation worker.
- Independent boundary-removal mutations were rejected: removing the actor key caused 5 failures; removing the synchronous pending lock caused 1 failure; removing completed-cursor admission caused 1 failure. These intentionally failing temporary sources were restored after each run, with exact production SHA-256 confirmed.
- `git diff --check` — exit 0. Production diff reviewed; no shared state or external API write added.
- Test environment: Node 24.19.0; installed React 18.3.1, react-test-renderer 18.3.1, Vitest 3.2.7, TypeScript 5.9.3. Existing installed dependencies reused without modification. Repository CI's Node 22 environment remains separately unverified.
- Verified dirty-content snapshot based on base HEAD above: production SHA-256 `86b04e6ff38ca1a3d96871c0cc0d9cbd728da3d546e1a1080810967a50582f56`; new test SHA-256 `37acf33a100dd929592c131fc44119c209650925dbda059323dd9156840aa3cc`; lockfile SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. Other production/test inputs are unchanged from the stated base.

## Handoff

The implementation unit and focused verification are ready for integration review. This is not a full local/CI/browser acceptance claim. The integration owner must run the required combined exact-content verification, examine browser behavior for route changes and auth dismissal, and coordinate any publication. Issue #213 stays open. No remote branch, Issue write, PR, push, merge, deployment or deletion was performed. Re-fetch main/Issue/PR ownership before publication; the final local preflight still found main at the stated base and no competing user-timeline implementation.
