# Admin loaded-user list projection

Status: locally characterized before/after; independent review and integration gates pending
Updated: 2026-11-03

## Ownership and alternatives

- Base: `f27b3a6614a91f5cfb4eac3dfdde6dc9a6c24e29`.
- Branch: `refactor/admin-user-list-projection`.
- Scope: `AdminUsersPage.tsx`, its existing component regression suite, and `src/lib/adminUserListViewModel.ts`.
- Fresh main and all 22 open PR changed-file lists were inspected; no scope overlap.
- Historical URL filter/sort boundary and identity/pagination lifetimes remain intact. No named retained decision covered this loaded-list projection.
- QuickEntry submission extraction was rejected: it already uses a plan builder while standalone-record and Todo submissions intentionally differ; another broad input API would add more plumbing than separation.

## Boundary

`selectVisibleAdminUsers` owns case-normalized actor/profile matching, activity
filtering and the existing recent/events/actor ordering for already-loaded typed
users. The page retains the HTTP reads, exact-profile identity lookup, URL
initializers/effect, pagination and presentation. The two narrow sort/filter type
unions move with the projection; no validation or framework is added.

The original comparator and locale behavior are unchanged, including actor-to-
profile fallback, missing recency and tie order. Copies preserve input arrays
and object identity. Memo dependencies remain `[filter, searchQuery, sort, users]`.
The final identity lookup is not replaced by this partial-match display filter.

## Evidence / remaining gates

A new public component characterization ran before production edits and again
afterward. It checks all filters and sort modes, count/recency ties, actor/profile
search with trim/case handling, null actor presentation, empty results and no
additional HTTP request. Existing pagination and request-order regressions remain:

- Before and after: 3 files / 40 tests passed, exit 0.
- Logs: `/tmp/client-admin-users-proof/before.log` and `after.log`.
- Fresh app typecheck and independent source review are tracked in the shared receipt.
- Full final-content integration verification and native/browser release gates are not claimed by this focused run.
- No persistence, schema, authentication or layout change. Rollback is this one logical change, with no data migration.
- Local-only candidate; no external publication is authorized by this checkpoint.
