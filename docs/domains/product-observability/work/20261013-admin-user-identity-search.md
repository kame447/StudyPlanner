# Admin exact-profile search ownership

Owning Issue: #213
Status: local implementation and focused verification complete; root integration pending
Branch: `fix/admin-user-identity-search`
Base / current HEAD: `819d5bac3791b0d0aac2a6b1fd977fe73256edf6`
PR: none; root coordinates publication. No remote writes authorized here.

## Scope and ownership

Reserve `src/components/AdminUsersPage.tsx` and a new `src/components/AdminUsersPage.requestOrder.test.tsx` for exact-profile identity search request ownership. Preserve service/backend/auth/privacy and normal user-list pagination. PR #605 owns UserDetail timeline; #395 already resolved Logs. Other open PRs including #602/#606 and #488/Jev are excluded.

Fresh pre-flight checked main through `git ls-remote`, open PRs, all branches (including final cursor), Issue #213 plus all comments, and historical admin/Users/identity PRs. No active exact-profile search owner found. Existing parent Issue is reused; no duplicate Issue or PR.

## Candidate comparison

1. Disabled button makes overlapping searches impossible: falsified by the independent input Enter handler, which calls search without a loading guard.
2. Latest search owns results but response callbacks are unguarded: supported by direct source; verify with deferred fake-API A/B success and failure order. Narrow UI-only blast radius.
3. The route/query synchronization or user pagination owns the wrong-result symptom: separate responsibilities. They cannot explain identity responses overwriting one another, and are outside this release unit.

An older request may be harmless if no later intent exists. Tests must therefore distinguish normal completion/retry from newer-input and newer-request ownership, with no live admin traffic.

## Next action and completion conditions

Reproduce through real component and service using mocked fetch. Then implement the smallest local lifetime boundary; verify older success/failure, repeated Enter, editing/clearing, retry, and navigation/unmount. Focused tests, exact diff and independent review are delegated deliverables. Root owns final combined full verify, browser/visual checks and any publication. Do not claim unrun stages passed.

## Implemented behavior

The current trimmed lookup string owns the visible result. Editing to another identity immediately invalidates the in-flight token, clears the prior profile/error/empty state, and allows the next search. Whitespace-only edits preserve the same identity. No lowercasing or client-side inference of email/UID/username is added.

Each submitted lookup has a synchronous unique token. Same-tick Enter/click duplicates cannot start a second request. Success, failure and final token release apply only to the active token; layout cleanup retires the view and rejects callbacks retained after unmount. Current errors remain retryable, and completed queries can be explicitly refreshed.

Backend/service/auth policies, normal Users list pagination, URL filtering, markup and CSS are unchanged. This local patch is independent from the service-side legacy-pagination read audit; root will integrate its caller delta separately if approved.

## Verification receipt — 2026-10-13

- Baseline real component + real admin service + fake fetch: **9 failed / 6 passed** of the initial 15 cases. Failures directly reproduced delayed A replacing B, stale errors erasing B, premature loading release, duplicate requests, stale edited/cleared results and same-tick old query submission. This is controlled reproduction, not production user evidence.
- Final focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/AdminUsersPage.requestOrder.test.tsx src/components/AdminUsersPage.test.tsx src/hooks/useAdminData.test.tsx src/components/AdminApp.test.tsx`: exit 0, **4 files / 32 passed** (18 new + 14 existing).
- `DEV_LAN_HOST=127.0.0.1 npm run typecheck`: exit 0, app and Worker, regenerated Worker runtime types. A fresh stable-input run followed fault-injection experiments; earlier concurrent typecheck is not the final receipt.
- Fault injection: remove duplicate guard → 4 failures; stale success/error checks → 8 failures; unconditional old finally → 2 failures; inactive callback guard → 1 failure. Production source was restored and final focused run passed.
- Root independently reviewed the exact UI diff and reported no blocking finding.
- `git diff --check`: exit 0.
- Final source/test SHA-256: `AdminUsersPage.tsx` = `6201bc7e492f4b7ede9eecdce7ca6c823366cc1fec2c9e63722e9f0b04435bd2`; request-order test = `6d96769bf7d720b6deed3857116db33a6290939069c7eb85948a343240aa336c`.
- Verification began on base HEAD `819d5bac3791b0d0aac2a6b1fd977fe73256edf6` with only the documented UI/test/checkpoint changes. Stable pre/post manifests match for **1,960 source inputs and 19,329 installed files** plus regenerated Worker type hash `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`. Documentation and caches are excluded from the source manifest.
- Toolchain: Node 24.19.0, npm 11.9.0, actual shared node_modules, Vitest 3.2.7, Wrangler 4.147.0. Node 22 CI is not verified here. Initial no-override Vite launch failed at `uv_interface_addresses`; explicit supported `DEV_LAN_HOST=127.0.0.1` avoids interface discovery and allowed tests to run.
- Reproduction, fault-injection, focused/typecheck logs and manifests are under ignored `artifacts/admin-identity/` in this worktree.

## Remaining integration criteria

Root owns the final exact-content `npm run verify` after any service-callsite integration, browser/visual acceptance, remote CI, and publication decision. None of those unrun stages are claimed complete. No live Firestore/admin/API requests, production writes, remote commit/PR, main push, merge or deployment were performed. No old branch was removed. The local branch remains needed for integration and can be cleaned up only after root completes its lifecycle.

Remote main was rechecked immediately before local freeze and had moved to `780bec4a14b1b5edc584a2eb348ba0af8bbeeb25`. This receipt proves the original base plus this local patch only; root must reconcile that newer base and verify the combined content. No automatic rebase or shared branch update was attempted.
