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

## 2026-10-29 follow-up — mobile drawer, stable return and readable metrics

The October 14 native-select/root-rebootstrap checkpoint above is historical; it is not the current design contract. New work starts from main `efbdb29eca9f171a2f1e4f48e08141e0706a879d` on `fix/admin-mobile-navigation-layout`.

- Audit the user-provided narrow-screen screenshots first. Replace the mobile select with the existing shared navigation in a left drawer and shift the content/header right. Reuse focus trapping and threshold swipe handling; reserve OS edge gestures and leave inputs, other dialogs, and horizontal data scrolling alone. Desktop sidebar stays unchanged; reduced/off modes do not animate the slide.
- Keep the return action outside the auth/access guards. Retain a previously started ordinary planner on Admin entry, including its existing auth prop identity, owner boundaries, scroll and focus restoration. Direct Admin entry must not bootstrap a hidden planner. This supersedes the old allowance for return bootstrap/data reads; it does not weaken administrator checks.
- Constrain the shared Overview/AI/Planning date controls at their labels/input boundaries rather than clipping all content. Tables remain locally scrollable. Audit all Admin routes at 320, 390 and desktop widths.
- Users trend adds an integer count axis/grid and an exact daily table. Missing dates inside the observed range remain unknown, never fabricated zeroes; actual zero values have zero bar height. No API/read-model change.
- Consumer announcement lazy-load failure gets an explicit page reload action, alongside return. The original intermittent failure cause is not established; this is a recovery path, not proof that its cause is fixed.

Local focused suites and full verification are recorded in the task receipts. New native browser cases cover both Chromium and WebKit, but test discovery alone is not rendered acceptance. Physical iPhone, actual OS edge navigation, and production data remain outside synthetic fixture proof. No upstream publication or merge is implied by this local checkpoint.


## 2026-10-30 native verification checkpoint — PR #929

The first published head `101989c7443f8890129949d418b9896a77214243` preserves local tree `f48fe4bc5b2a2cc6e4dd6b7a5ae1c5cd4367950d`. Native merge checkout `00512c5d39db1e6bf3ad0c97dcc208f520b99338` passed fresh types, 12,129 unit tests and build, but Admin render was **71 passed / 12 failed**; this is not acceptance.

The full failure inventory was audited before correction:

- Standard-motion drawer focus fails in both engines while reduced/off focus passes. The existing layout-effect focus runs while CSS visibility is transitioning from hidden. Opening now changes visibility immediately, keeping the transform animation; the shared focus hook is unchanged. Native confirmation remains required.
- The synthetic swipe test immediately clicked without a new touchstart, inside the shared 700 ms ghost-click suppression interval. Keep that production guard; represent the next deliberate touch before clicking, and assert reopening before selecting a page.
- Graph fixtures read the harness query after awaiting the legacy service, by which time the real Users page had normalized the URL. Capture the fixture selection at module entry instead. Keep the independent expected 3 / 0 / missing / 7 counts and four bars.
- The older announcement return test still selected a native menu. Exercise the actual drawer buttons instead; keep session/document/publication assertions.
- Three document-overflow failures lack route/DOM evidence in the first dedicated artifact. Do not hide overflow or relax the 1 px threshold. Collect all nine routes with failing soft assertions, route-labelled geometry and finally-written evidence; retain browser failure traces/screenshots under the uploaded artifact directory.
- The Admin-entry harness omitted authentication subscriptions. Correct its owner lifecycle without remounting on same-owner notification. The separate real-root audit reproduced stale state with tracing disabled (the production default when unconfigured). Key the fallback App by its existing authentication epoch; same-owner notifications/ordinary Admin returns remain retained, while external sign-out or owner change retires prior state. Formal regression: two failures before correction, then 157 related tests passed. The actual deployed feature flag value is unverified.

- The general browser source-reader also flagged the new Admin-return focus. Register only its exact non-text header button/link statement, with negative input/generic/unscrolled-focus cases. The same source-reader test reproduced red before correction and passed afterward; an actual Admin-return header-focus assertion remains for native execution.

Draft #929 remains unmerged. Acceptance requires corrected exact-source gates, both native engines including failed routes/focus and external sign-out, independently checked geometry artifacts, and native confirmation of the trace-disabled real-root correction. Do not count collection or synthetic touch dispatch as physical iPhone validation.

### Second native result and scoped overflow correction

Head `961ea1af3a8cd71b101d2e870c939b47f034940e`, native merge checkout `c9f3ac87d3ae1830b4a85046653611e260bfa851`: Admin render **80 passed / 3 failed**. Drawer focus/gestures, the exact graph fixture and the previous selector failures passed. The remaining failures are text layout, not date controls: WebKit at 320 px overflows 21 px on the user Timeline; the AI metrics at 1280 px overflow 38 px in WebKit and 3 px in Chromium. Saved route geometry, trace DOM and the narrow failure screenshot identify long Timeline identifiers and the rightmost cost metric's unbroken value as the responsible min-content constraints.

Allow natural wrapping in the Timeline text container and AI metric value, without clipping, reducing font size or hiding content. Keep all nine route checks and add child/container and text scroll-width bounds. This correction still requires native confirmation.

Separately, a 1280 px WebKit route-fade scenario reached its overlay-close step around 29 seconds into a 30-second test. Split the independent cold/warm route checks and rapid/overlay flow into separate tests; keep the 30-second budget and all geometric/focus/motion assertions. B retains the existing 150 ms production contract; A's separate 300 ms feature is not copied into this branch.
