# Month view startup loading

Status: approved for publication; combined verification and native acceptance in progress.
Issue: #542 (existing performance owner); closed #479 is historical evidence only
Branch: `perf/defer-month-startup`
Base source: remote main `56a8e52212b72074e99f092d91b1bef488bc365f`, tree `9a4bf105d3c76b5290e24a2283669c14e0fbaca5`; local base `a716b343fa1c0741a3ac215fbc862caacf841e27` has the identical tree.

## Approved integration checkpoint — 2026-10-16

The owner has approved publication and main integration after browser verification. The following local implementation records retain their original test scope and historical limitations. Current release status is tracked in [Issue #542](https://github.com/kame447/StudyPlanner/issues/542#issuecomment-6209395456) and the four responsibility-specific PRs, rather than inferred from these earlier local measurements.

The release is composed on actual main `56a8e52212b72074e99f092d91b1bef488bc365f`, preserving all prior changes. Month lazy loading and its bounded preload registration are accepted together; material detail reuse and corrected administrator CSS are additional independent review units in the cumulative release. Final combined full verification and native browser acceptance must complete before main integration. Existing capacity-budget failures remain separately deferred without changing thresholds. Physical-device speed is still unmeasured.

## Ownership and preflight

Read current AGENTS, domain documentation, #542 body/latest comments and closed #479; searched current open PRs, relevant closed PRs and all remote branches on 2026-10-16. No active MonthView startup split owner was found. Existing contact/streak changes are in the baseline. External #696/#702/#703/#704, #488 and Jev work are excluded. No remote Issue/branch/PR writes are authorized by this local task.

This unit owns App.tsx lazy loading and its focused tests. The navigation-loading owner owns preloadAppViews.ts and will separately add MonthView after the App-only result is measured. No Firestore readers or auth/consent/preferences/memory readiness boundaries are changed.

## Decision and falsification

Three candidates were considered: relax serialized startup gates (rejected: changes consent and owner authority); defer settings UI (larger navigation/focus lifetime surface); defer MonthView (selected: Home is the initial surface, and App is its sole eager production importer). A synchronous month shell can preserve the header/navigation while optional schedule code arrives. Reject or revise if MonthView dependencies remain in the initial graph or if navigation, owner changes, month-create request delivery or failure recovery regress.

## Verification and next action

Capture actual production Vite static JS import closure raw/gzip on the unchanged baseline and candidate with identical installed dependencies. Verify delayed module delivery, navigation cancellation and re-entry, owner/sign-out, month-create request, existing App/navigation/startup boundary suites, fresh app typecheck, and build. Worker supplies focused proof; integration owner runs the single final combined full verify. Browser launch has a known socket EPERM limitation in this environment and will not be retried unchanged. Build bytes and injected delays are not measured real-device startup seconds or Firestore billing savings.

## Local candidate acceptance — 2026-10-16

The change is deliberately bounded: App's MonthView import is replaced by a synchronous `DeferredMonthView` shell. The shell holds one request-ID ref, lazily imports the existing view, and keys its request scope by owner. MonthView accepts an optional initial request ID; ordinary direct callers retain their previous initialization. App gains no new state, network/data reads, schema or authentication behavior.

A plain lazy import had a concrete regression: an add request made before chunk delivery became the first mounted view's already-handled ID, so the month editor did not open. With the real MonthView/MonthEventDialog, the original ref initializer fails the new controlled test; the shell-held initial ID passes. Tests also cover cancellation, owner replacement before delivery, repeated entry without replay, and another explicit add request. The existing AI-to-manual-calendar save integration now awaits the real dynamic import before the same unchanged assertions; AI semantics and persistence are unchanged.

The pending fallback uses the same ordinary SplashScreen as other optional workspace views, without `fixedLight`. Its video predicate is false; the component test asserts zero video elements and one ordinary loading logo. A rejected module is caught within the month surface. The real App test verifies that the existing Home navigation remains usable, no save occurs, and no page reload occurs. There is deliberately no new full-reload action that could discard unsaved AI input.

### Delivery measurement

Actual Vite/Rollup output, following the main entry's static JS imports recursively. Dynamic chunks are excluded from the initial closure; gzip is the sum of independently compressed chunks. Both builds use the same installed dependency location and configuration, with no production Firebase credentials or API. This is a delivery proxy, not a measurement of device render time or a speedup in seconds.

| Metric | Main source baseline | Final local candidate | Delta |
| --- | ---: | ---: | ---: |
| Initial JS raw bytes | 1,716,857 | 1,681,079 | -35,778 (-2.08%) |
| Initial JS gzip bytes | 465,265 | 455,129 | -10,136 (-2.18%) |
| All JS raw bytes | 2,571,094 | 2,573,326 | +2,232 |
| All JS gzip bytes | 706,390 | 709,547 | +3,157 |

Eleven source modules leave the initial graph, including MonthView, its grid/day sheet/event dialog/date picker and their optional motion helpers. The small shell enters the initial graph. Splitting increases aggregate size while reducing startup delivery; this is not a claim that all bundle budgets pass. Existing thresholds were not changed. Baseline/candidate build times were 6.32/5.70 seconds; these are compiler durations only.

### Verified and remaining

- Final focused run: **216 tests /16 files passed**, including actual month editor/save, App navigation/recovery, root/owner/consent/preferences/startup/video/public-navigation boundaries.
- Fresh non-incremental `npm run typecheck:app:full` passed; production Vite build passed.
- Final focused/type/build input identity: 2,791 source inputs and 19,329 installed files identical before/after. Source SHA-256 `8f562239aec17fed54924b2aac51b44795e821f0235af7117ab897e412b5f1d0`; installed-file manifest SHA-256 `a9b764a54f147a0f8296d9ea39a1a3614e2a37b40f8f59cdac7647448eae74d5`. The subsequent change is this documentation only.
- Node 24.19.0, Linux x64, TZ UTC, DEV_LAN_HOST 127.0.0.1; Vite 6.4.3, React/react-test-renderer 18.3.1, Vitest 3.2.7, TypeScript 5.9.3.
- New browser spec syntax and Playwright collection passed: six cases at 390/1280 px for pending add, abandoned navigation and failed delivery. **Native execution is unverified**; the existing socket EPERM capability blocker was not retried. Browser collection is not a runtime or visual pass.
- Startup/readiness gates are unchanged. Synthetic cold/warm critical-path tests still use injected delays, not measured Firebase or iPhone timing. The temporary standalone iPhone white screen reported during this work recovered without production changes; its cause remains unverified and is not claimed fixed by this candidate.
- The separately owned navigation-loading unit adds MonthView to post-readiness preloading; this worktree intentionally does not edit preloadAppViews.ts. Combine the two before any publication and remeasure the integrated graph. Preload remains behind existing owner/readiness gates, and its scheduling tradeoffs have separate evidence.
- Final combined full `npm run verify`, independent integrated review, applicable native browser/visual checks and any authorized publication belong to the integration owner. No remote branch/PR/Issue, main change, merge, deployment or branch deletion occurred. Existing #542 is reused; the new local `perf/defer-month-startup` branch represents this distinct reviewable unit and should be removed after eventual merge or explicit abandonment.
