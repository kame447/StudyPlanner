# Admin mobile navigation and announcement actions

Status: locally verified; native verification and publication approval pending
Updated: 2026-10-14 UTC

## Ownership and preflight

- Branch `fix/admin-mobile-navigation`, base `fe8aa40d9e3ceb594c01f29e6f9f6d2521c69bb2`; PR #646 is already merged. This is the user's new follow-up, separate from approved release PR #650.
- Read AGENTS in full, current main, Issue #483 and comments, both pages of remote branches, and related open/closed PRs. No active implementation of this admin return/mobile/one-action publication scope was found. Existing admin data race and observability work is not changed.
- Own AdminApp, AdminAnnouncementsPage and their tests; new application-route boundary and main entry wiring; new scoped admin-mobile CSS. Consumer notifications and their CSS belong to the separate notification worker. No repository wiring, Firestore Rules or permission change.
- Admin native cases at the end of announcements.spec.mjs belong here; consumer cases belong to the notification worker. Coordinate shared harness changes before editing.

## Reproduced boundary and intended correction

- The return link exists only in the sidebar footer, which is hidden below 820px. Mobile users therefore have no visible return affordance. Move the return action into a persistent header available even while auth/access is pending or denied.
- main.tsx chooses the root once from the initial pathname. Introduce a small reactive root boundary so admin return and browser Back/Forward switch roots without document reload, reusing the same auth service. Keep existing administrator checks; do not keep private admin content mounted after return or owner changes.
- The current editor requires saving, reopening a preview, then publishing. Offer explicit draft/save and publish actions directly on the editor, using the existing revision-checked draft save and atomic publication. Preserve an acknowledged saved revision when publication fails so retry does not overwrite another editor or duplicate publication.
- Improve narrow-screen navigation, readable input sizes, wrapping and touch targets without changing analytical data or broad planner styles.

## Verification and exit

Next: focused regression red/green, exact fresh verify, browser-free native discovery, independent review. Local browser launch is already known to fail with socket EPERM and will not be retried. Native rendered UI and physical iPhone are unverified until the applicable approved browser work runs. No upstream publication or main merge is authorized for this new scope yet.

## Local implementation checkpoint

- The return header is visible outside auth/access guards at all widths, including pending, signed-out and denied states. Mobile navigation uses a native labeled select; editable controls retain at least 16px text and 44px targets. Existing analytical data and permission checks are unchanged.
- ApplicationRouteRoot reuses the existing history subscription and owns gesture installation/cleanup while the normal root is mounted. It creates a shared auth wrapper only on admin entry, then reuses it on return. Ordinary and public initial paths retain the existing LaplanceAppRoot/PublicPageBoundary authentication boundary without a duplicated public-path list. Return avoids document reload and sign-out; the normal app may bootstrap and read its data again.
- The announcement form offers explicit publication and draft save in the same editor. Enter submits a private draft. Successful draft acknowledgement updates the retained revision; retrying a failed publication does not save another revision. Editing after failure saves the next revision normally. Leaving the owner page blocks both a retained callback and publication after a late draft-save result. Existing server transactions, Rules, owner checks and bounded listing are unchanged.
- Red reproduction against the original announcement page: 6 failed / 2 passed for the new direct-publication contract. Initial focused auth/root/editor coverage: 185 passed / 12 files. Initial exact verify passed 8606 tests / 907 files, fresh types and build 5.61s; source 2623 files, installed dependencies 19329 files and generated Worker types were identical before/after. This is **before** the public-page auth correction, not final evidence.
- Root review identified a saved-input callback bypass; an active-owner start guard and exit regression were added before that initial full run. A subsequent public-startup regression reproduced one unwanted auth factory call. Deferring wrapper creation to admin entry passed 68 related tests / 5 files, including existing public-page and auth lifecycle cases. Final full verification of this corrected snapshot remains pending.
- Existing Admin native discovery collected 67 cases, including two new 375px/1440px same-document return/session/back/forward and direct-create/publication cases. The unchanged consumer notification cases belong to a separate worker; the two original administrator cases were updated for the requested direct action. A small harness-only normal-root substitute observes the injected auth session; real Firebase login and physical devices are not claimed by that fixture.

## Corrected exact final verification

- Final `npm run verify` exited 0 after fresh app/Worker types, **8,607 passed / 907 files**, 54 skipped / 1 todo and production build 5.39s. Command-local environment: `DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false DO_NOT_TRACK=1 XDG_CONFIG_HOME=/tmp/admin-mobile-config VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=2`. No runner, test or budget threshold changed.
- Source 2,623 files, SHA-256 `0da28cdd97d67b3ebaef67d714b538e770ee4410b89032b345566ea27803925e`, and actual installed dependencies 19,329 files, SHA-256 `138fd1f4067bf1586ae7d4df4526af11b70be14dca7ca704381ef607cea620ee`, match before/after. Worker declaration hash remains `c96c8ed5d4ba9748b9b191362998ccf92a7a7ae97a7f8c4a7bce008b1fedef79`. Only this documentation changes afterward.
- The existing wire-compatibility test generated 217 historical fixture files from `070d25cbe14796aebb8168ac5425c93e3506df1c`; every file matched and the generated tree was preserved outside the checkout before comparison. No generated test input is committed or left for later discovery.
- The Admin harness, including its new route-return fixture, builds successfully with the existing Vite configuration. Native test collection remains 67 cases on local Playwright 1.62.1; browser bodies were not executed locally. Existing GitHub native CI uses its pinned runner independently.
- Root independently reviewed the auth/return and publication owner boundary. Its retained-callback and public-startup findings were repaired with explicit regression tests. Existing server service and Rules are byte-unchanged; production permissions and prior atomic revision checks are preserved.
- Bundle checking remains failed on the same six acknowledged capacity metrics: JS total raw/gzip 2420.7/658.9 KiB; CSS total raw/gzip 506.8/87.7 KiB and largest raw/gzip 423.8/69.2 KiB. Per-JS-chunk and appearance checks pass. Thresholds are untouched; this is not a claim that every quality gate is green.

Evidence: `/workspace/shared/laplans-admin-mobile-verification/final/`, with earlier red/green and initial proof in its parent directory. Final acceptance still requires separate publication approval and actual native results. Document reload is avoided, but ordinary app bootstrap/data reads may occur on return. Real signed-in production accounts and physical iPhone remain unverified. No new production permissions, dependency or workflow is introduced.
