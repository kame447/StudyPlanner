# Admin query snapshot ownership

Status: locally implemented; focused verification passed; full integration verification pending
Owning Issue: #213
Updated: 2026-10-13

## Scope and ownership

Branch: `fix/admin-query-snapshot-ownership`.
Base and initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`.
No pull request or remote publication has been created for this work.

The existing admin query loader owns which loaded snapshot can be displayed for the current request. This unit changes that boundary and its tests only. It does not change analytics semantics, add metrics, change auth, or touch the #542 Users page-only service/API optimization.

Preflight read the current AGENTS.md, canonical domain requirements and roadmap, Issue #213 and its latest comments, all 14 open PRs, all 109 remote branches, and related closed PR search. No current owner or branch matched this query-snapshot display defect. Completed #605/#607/#618/#625 have separate acceptance conditions.

## Reproduction

On the exact base, the real AI/API component and real `useAdminDataLoader` were rendered with an offline deferred service. After a successful production response showing 101 requests, switching to preview left all five old metric cards visible. Rejecting the preview request left production's 101 requests visible alongside the preview error.

The loader retains previous data across load changes; AI/API and Planning render whenever data is non-null. Overview additionally checks ready state. This is distinct from late responses overwriting a later success, which the existing effect cleanup already rejects.

## Acceptance

- When an applied environment, period, or explicit refresh starts a new load, the first committed view must not expose the prior snapshot as the current result.
- Pending and failed requests expose the caller's initial data, and retry can publish the latest successful snapshot.
- Late success/failure from an obsolete request and completion after unmount cannot publish state.
- Invalid date drafts retain the valid applied query and do not start new requests.
- All five existing callers remain covered: Overview, AI/API, Planning, Users, and User Detail.

Same-condition refresh deliberately clears the visible snapshot while loading or after failure. The pages already show a loading/error state; this unit does not add a stale-data presentation contract.

## Verification checkpoint

The production implementation is confined to `src/hooks/useAdminData.ts`. The loader now publishes an atomic result owned by the current load callback, returns the initial/loading view when the owner differs (before passive effects), and uses initial data after failure. Existing obsolete-request cleanup remains in place. The five callers and service/API files are unchanged.

Verification on the local source/test content:

- Real AI/API and Planning component tests on the unchanged base: **6 failed, 4 passed**. The six failures independently cover environment, applied period, and same-condition refresh on both pages.
- Final focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/AdminAnalyticsPages.requestState.test.tsx src/hooks/useAdminData.test.tsx src/components/AdminUsersPage src/components/AdminUserDetailPage src/components/AdminOverviewPage src/lib/adminDateRange.test.tsx --maxWorkers=2`: **8 files, 65 passed, exit 0**.
- `DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false npm run typecheck`: app and Worker passed, exit 0. Initial new fixture type errors were corrected to the actual histogram/checkpoint contract, without weakening assertions. Wrangler generated the required local runtime types; its attempt to write a global diagnostic log was blocked, without blocking generation/typechecking.
- `git diff --check`: passed.
- Installed packages: React / react-test-renderer 18.3.1, Vitest 3.2.7, Vite 6.4.3, TypeScript 5.9.3, Wrangler 4.147.0. Dependencies reuse the existing local startup-diagnostics installation; the parent must record/verify installed identity for the final integration snapshot.

Caller impact: AI/API and Planning no longer display an old snapshot during loading/error. Overview retains its loading/error presentation and additionally avoids a first-commit mismatch. Users has a fixed load callback; changing an equivalent initial-data object does not trigger a load. User Detail still remounts by actor, preserving its existing timeline ownership. Invalid date drafts retain the applied valid query. Hook-level layout-commit assertions cover the interval before effect cleanup/reset; obsolete success/failure and unmount remain covered.

## Existing browser gate

Added one 390px AI/API browser case to the existing admin harness: successful production view → preview pending → failure → explicit refresh success → valid period change → success. It verifies actual DOM card disappearance/reappearance and the service's requested environment/date, without expanding the unit matrix or adding a new test platform. The stub's deferred controls are available only in `state=query-ownership`; populated/empty/error fixture behavior is unchanged and separately smoke-checked.

`tests/e2e/playwright.admin-overview.config.mjs` registers the new spec, so the existing `.github/workflows/admin-overview-render.yml` command will run it on an authorized PR publication. Playwright `--list` confirmed 53 registered tests in 4 files, including this case; spec/stub syntax checks passed.

Local real-browser execution is **blocked before any test assertion**: system Chromium 154.0.8037.57 exits because its local process-singleton socket is forbidden (`socket() failed: Operation not permitted`). One normal execution and one approved escalated execution failed at the same launch boundary. The local runner is Playwright 1.62.1; the existing CI installs 1.64.0. No actual DOM or screenshot pass is claimed. Do not treat the harness smoke/discovery as browser validation.

Next: independent review and the parent's single final `npm run verify` for combined content, plus the existing browser/render gate after publication is authorized. Full suite/build, authenticated production behavior, remote CI, and deployment have not been claimed as verified by this local unit. No new Issue or PR was opened; no upstream push, main mutation, merge, deployment, or branch deletion occurred. Reuse Issue #213; retain this local branch until integration or abandonment is decided.
