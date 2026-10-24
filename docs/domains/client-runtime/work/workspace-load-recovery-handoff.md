# Day, timetable and report delivery recovery

Status: active, local implementation and independent source review complete; publication pending
Owner: runtime lane; related Issue #542
Branch: `fix/workspace-load-recovery`
Base: `2995702eb293f42e8fa05ba7949f1439f92adff9`
Baseline reproduction: `bd71dcc888664a572033581d9e3bfbe2faabfcae`; 09:18 UTC fast-forward pulled only #723 dev/preview security changes, with no view/root changes. Final related tests must use the updated Vite config.

## Scope

Audit the actual app entries for Day (including its synchronous timeline), Timetable and Report. Preserve existing view internals and pending Admin/Announcements/Bookshelf candidates. Triage's 2026-10-17 09:12 UTC check found no delivery-recovery owner among 34 open PRs. Motion PRs #703/#707 retain their internal behavior scope.

## Alternatives and disconfirmation

1. An existing ancestor boundary protects these entries. Inspection finds Suspense but no exception boundary around these three modules; an actual-root rejection with retained tree would disconfirm the defect.
2. Optional preloading handles the error. Its rejection catch protects background warming, not a foreground lazy render. Reproduce the real navigation with only warming suppressed.
3. Foreground import rejection loses the root. If reproduced, use a named local shell for each affected view, following Month's existing boundary. Avoid a global or generic error framework; keep auth/data/history above recovery and no forced reload or false cached-import retry.

## Confirmed defect and repair

The baseline passed three demonstrations under real ApplicationRouteRoot → LaplanceAppRoot → App. Each real Home entry for Day, Timetable and Report started a rejected optional module import, lost the entire React tree, removed its history listeners and could not recover on popstate. Four desired recovery cases then failed on the unchanged runtime.

Three named local shells follow the existing DeferredMonthView pattern. Each contains only its own surface, keeps the existing Splash fallback and forwards every view prop. Day/Timetable reset by userId; Report is keyed by user.id at its existing App callsite. App, auth/session, data and history stay above the failure boundary. Return/reentry remains usable; a cached rejected module is not falsely retried and the document is not forcibly reloaded. Descendant render errors are contained as in the existing Month pattern.

DayTimeline is synchronous within DayView. DayView, TimetableView, ReportView and all timeline, report, material and motion internals are unchanged. OCR's nested optional import is not separately redesigned. Other lazy surfaces and the pending Admin/Announcements/Bookshelf candidates are not included or claimed fixed.

## Verification checkpoint

- Actual-root baseline: 3 reproduced root-loss cases; expected recovery red: 4 failures before repair.
- Focused final run on base2995702e: 13 files / 95 tests passed. Covers the 10 new actual-root failure/account/sign-out, pending leave/cached rejection, and real successful module delivery/current-owner props cases; plus Day timetable selection, Timetable editor lifetime, Report behavior, AI navigation/fixed-event handoff, root/public/Month boundaries and preloading.
- Fresh `npm run typecheck:app:full`: exit 0 on final TypeScript inputs.
- `node --check` for the new browser spec and `git diff --check`: passed.
- Production-module JS abort and pending-departure browser definitions: six cases collected across Chromium desktop, Firefox desktop, WebKit desktop and WebKit mobile (24 definitions). No new aliases, harness changes, timeout increases or assertion relaxation.
- Use the anchored selector `workspace-load-recovery\.spec\.mjs$` for native selection. An initial unanchored collection also matched this worktree's absolute directory name and listed 835 cases; it executed none. Anchored recollection confirms only the intended 24 cases.

Environment: command-local DEV_LAN_HOST=127.0.0.1, TZ=UTC, CLOUDFLARE_CF_FETCH_ENABLED=false, WRANGLER_SEND_METRICS=false, DO_NOT_TRACK=1; two Vitest workers. Canonical installed dependencies and package-lock are unchanged. The real Timetable module reports missing Firebase configuration in this local fixture; fetch is forbidden and no production service or data is used.

Native execution remains unverified under the existing launch denial and was not retried. No whole-suite verify, production build, CI or publication was performed. Related-tests-only direction and integration ownership remain explicit.

Independent source review completed on the frozen twelve-file input manifest: no blocker. Source, test and browser/config inputs are unchanged since their recorded checks; this final checkpoint update changes only documentation.

09:24 UTC upstream read-back is now `114adf768847199895f4a990eed53096460b4c69` (#724 telemetry/shared contracts). It does not overlap the changed view/root/config paths, but its shared inputs were not part of this candidate's verified base2995702e. Keep that distinction in the integration receipt.

Next: retain this local candidate for the integration owner's publication decision. On composition, preserve the pending Bookshelf deferred import and union this browser entry with the pending Announcements entry; reconcile latest-main shared inputs and run the applicable related verification. No generic framework or GitHub/main writes.
