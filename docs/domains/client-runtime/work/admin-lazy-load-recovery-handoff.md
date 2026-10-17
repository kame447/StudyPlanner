# Administrator module failure recovery

Status: local repair and focused verification complete; integration/browser gates pending

- Owning follow-up: Issue #542; separate from released PR #716 / #652 entry navigation.
- Branch: `fix/admin-lazy-load-recovery`
- Base/HEAD: `7f953920c830ce88ad54b281c339656e21c3f79b`
- 2026-10-17 05:55 UTC ownership check: fresh main, 194 remote heads, 30 open PRs plus related closed Admin PRs checked; no active Admin lazy-failure recovery owner. #717/#718/#719 and their semantic/runtime responsibilities are excluded.
- Scope: reproduce actual ApplicationRouteRoot failure during Admin module delivery, establish navigation consequences, then select the smallest recovery consistent with existing optional-screen boundaries. Do not modify the released entry candidate, Admin authorization, chat dirty-state authority, persistent data or shared styles.

## Competing explanations to test

1. A rejected Admin import escapes Suspense and unmounts the route root, losing both the screen and its history subscriptions. Supported by missing ancestor error boundary; falsified if actual test-renderer root remains mounted with recoverable navigation.
2. Suspense or a global delivery handler retains the loading state or reloads automatically. No global handler was found in source; falsified by a thrown rejection, null tree and zero reload calls.
3. Failure is limited to Admin but browser Back still restores normal UI. Plausible if the URL owner survives; falsified if root history subscriptions are removed and Back does not remount content.

## Verification plan and exit criteria

Use the real route root and controlled lazy import rejection in React test renderer. Cover direct Admin startup, normal → Admin, Back while pending, failure then return/Back/Forward and no authentication mutation. Compare the existing Month and Contact local boundaries before selecting a repair. Focused tests/typecheck and exact diff review are worker evidence; full integration verification and native browser acceptance remain the integration owner's gates. Local native browser launching is denied by the environment (`socket() failed: Operation not permitted`); do not retry or bypass.

## Reproduced baseline (2026-10-17 05:57 UTC)

The real ApplicationRouteRoot with a rejected Admin module unmounts to a null React tree in both normal → Admin and direct `/admin/users` startup. After React flushes passive cleanup, both history listeners are gone. Changing the URL back to `/` and dispatching the available popstate callback does not restore any content. No reload, assign or sign-out occurred. Two baseline reproduction cases pass, proving the failure rather than claiming repair. `src/main.tsx` provides no enclosing error boundary; there is also no global preload-error recovery handler.

The first reproduction attempt incorrectly passed React's nonstandard act thenable directly to Vitest's rejects assertion. The second fixed that wrapping but observed before passive unmount cleanup. The final baseline uses a real async Promise and flushes cleanup; it has no unhandled Vitest errors. These harness corrections changed no production source. Evidence: `/workspace/shared/laplans-admin-load-evidence-20261017/baseline-confirmed.log` and the retained baseline test copy.

## Repair candidates

1. **Local Admin failure boundary using the existing Contact/Month pattern.** Retain ApplicationRouteRoot and its auth/history owner. Show a plain failure alert, same-document normal return via its current callback, and explicit document reload (Contact already uses explicit reload for a rejected cached import). Minimal blast radius and directly testable.
2. **Global root error boundary.** Could also catch unrelated normal/planner errors, but expands recovery responsibility and may replace unrelated UI. Reject for this task.
3. **Automatic reload or reset-and-retry lazy imports.** Reload can discard state without consent and cache-reset retries cannot ensure a failed module graph is fetched again. Reject; use an explicit reload instead.

There is no reusable exported generic boundary in the current repository. Reusing the established local pattern avoids introducing a new framework or refactoring unrelated Month/Contact behavior. The selected boundary necessarily also catches an Admin descendant render error; it must never render protected content or mutate authentication. Browser-rendered layout and actual chunk-network behavior remain unverified locally.

The integration owner approved the reproduced Admin-only repair. The local boundary now wraps only the Admin branch; it leaves the existing pending fallback, history owner, shared auth wrapper, entry dirty-warning and Admin access checks unchanged. Returning unmounts the boundary. Reentering a rejected module shows the honest failure again; only the explicit reload requests a new document. The new failure screen uses shared styles already present before Admin assets arrive. Frozen PR #716 code is untouched.


## Verification checkpoint (2026-10-17 06:01 UTC)

- Baseline recovery contract: all four new recovery cases fail on the unchanged production root due to the escaped import rejection. After the local boundary, the four pass. The original two-case failure reproduction is retained outside the repository as evidence, not as the desired product contract.
- Focused verification: 21 files / 188 tests passed, exit 0. This includes the new eight root cases, existing root/Admin/My Page/auth/public page tests, actual chat checkpoint and leave-warning coverage, and the Month/Contact boundary/style guards.
- Fresh `npm run typecheck:app:full`: passed, exit 0. `git diff --check` and both browser spec syntax checks passed. No dependency, shared harness, CSS or workflow changes.
- New browser cases: same-document failed entry → normal return → cached Back/Forward; production Admin JavaScript rejection → explicit reload → existing signed-out guard; production Admin stylesheet rejection → explicit reload → existing signed-out guard. They extend the existing two Admin specs selected by all four cross-browser projects. Collection passed: 48 existing/new cases in two files, including mobile WebKit. No local browser launch was retried. Native execution and rendered layout remain unverified for this candidate.
- Runtime input identity: Node 24.19.0, React and renderer 18.3.1, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3; canonical dependencies shared from the recovered base. Lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`; installed lock SHA-256 `6964e32dd8cfa9e3912b31f4b53858df2c99d7f2cd45f15bc0c069190de37940`.
- Evidence directory: `/workspace/shared/laplans-admin-load-evidence-20261017/`. Baseline, red/green, focused, typecheck, browser collection and final exact-input receipts are separate. An independent reviewer checked all eight frozen input hashes, the final runtime/browser definitions and verification evidence; no blocking source defect was found. Only this superseded-checkpoint wording was cleaned up afterward.

Next: hand the exact local commit to the integration owner. Before publication, the final combined content still needs full `npm run verify`, production build and native browser gates. No external write, main change, branch deletion, production account or production API was used.
