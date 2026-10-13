# Class detail, attendance, and associated schedules

Status: active local implementation
Updated: 2026-10-13
Branch: `feat/class-detail-attendance`
Base and initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`
PR: not yet created. Branch/PR publication and verified main integration are approved; owner-only access for the new production attendance collection still requires the parent’s specific confirmation before merge triggers Rules deployment.

## Request and scope

The user requested a clearer lesson editor, attendance management and lesson-related schedules, with the four supplied screenshots as functional references rather than a layout to copy. The entry should show a compact lesson summary, attendance counts/history and schedules. Forms appear only after an edit/add action.

## Ownership and boundaries

GitHub main, open PRs, related issues and all available branches were checked before implementation. No existing attendance implementation was found. PR #541 remains the owner of occurrence cancellation/Undo and day-timetable controls; those responsibilities are unchanged. Issue #483 is the existing small-UI umbrella, not an attendance persistence owner. This record owns this local feature until publication is authorized.

- Attendance is independent from study Actual records and cannot affect studied-time metrics.
- One attendance record per authenticated owner, immutable lesson ID and date; status is correctable. Renaming a lesson must not lose records.
- Associated schedules use existing Plan → canonical ScheduleEvent persistence, with an optional lesson ID reference. They do not masquerade as timetable occurrences or introduce another calendar authority.
- Attendance repository reads only the open lesson, rather than expanding startup reads.
- Rules changes remain a candidate: no production deployment or expanded access has occurred. Before main merge, confirm the new owner-only production attendance collection access because main triggers automatic Rules deployment.
- Notifications are outside this slice because the current app has no reminder delivery implementation.

## Current checkpoint

Resume ownership: the existing branch/worktree was reassigned on 2026-10-13 without discarding its dirty implementation. Remote exact-branch PR and attendance-title Issue searches found no duplicate. The next change addresses real calendar-date validation in Rules and routes related schedules through an explicit create boundary, followed by regression and available emulator/browser verification.

Feature commit: `bab069db`. Exact verified integration HEAD: `f98610b4ebdc6fb6c16f8ba1e835b5c0199110eb`, tree `0cb8278947e56c0808530a6d8661e4a4d4e0ea18`. It normally merges current main `782f3559` and the approved #626/#627/#629/#630 predecessor `341aa6f4`; the subject deletion/Undo fix is preserved. The only later change is this documentation checkpoint.

Implementation:

- A lesson opens a compact summary, attendance counts/history and related schedules. Attendance/schedule input opens only on demand. The editor keeps primary fields visible and groups optional lesson details behind a disclosure.
- Attendance has dedicated local and Firebase adapters with one record per owner/lesson/date. Firebase reads require a server snapshot and saves check the owned class in a transaction. Correction preserves creation identity; removal of a template does not erase attendance history. The new Rules grant access to the owner only, without an admin-access expansion.
- `classTemplateId` survives Plan draft editing, canonical ScheduleEvent conversion and repository reload. Timetable occurrence provenance is not reused.
- Existing editor save/deletion lifetime protections are retained. Both detail and editor have dialog focus/Escape handling.
- Added an isolated Rules regression to the existing demo-only emulator entrypoint, and a browser scenario covering 320/390/1280px, attendance correction, associated schedule persistence and rename/reload.

Verification at this checkpoint:

- 13 focused files / 144 tests passed, including all 15 existing editor lifetime cases, new persistence/UI tests, and related schedule authority/timetable regressions. Command: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs run --config vite.config.mjs --configLoader native --maxWorkers=2 --minWorkers=1` with the 13 affected test paths. Evidence: `class-attendance-evidence-20261013/attendance-expanded.log` in the parent workspace.
- App TypeScript check passed (`--noEmit --incremental`, per-worktree cache). Worker/full verification and production build are still pending.
- Browser collection only: Chromium 58 cases across the new/affected three files; cross-browser 12 new scenarios. No real browser execution or rendered image verification has occurred. Collection used an available isolated Playwright 1.62.1 runner; canonical CI installs 1.64.0.
- The new Rules script and E2E scripts pass `node --check`; `git diff --check` is clean.
- The initial bounded offline lookup did not find Firebase tooling. A later shared-tooling inspection found existing Firebase CLI 15.33.0 and Firestore emulator 1.22.0. Using isolated demo-only configuration and normal permissions, the complete existing Rules entrypoint plus attendance passed (exit 0). Owner-denial, correction/history, calendar-month and leap-year validity were exercised; exact file hashes and command are in the evidence receipt. No dependency download, credentials or production deployment was needed.
- Review fixes: related schedules now use a small explicit create operation through the existing persistence-result projection boundary. Normal and recurring global editors remain untouched, and the promise waits for durable save. Four regression cases plus the existing attendance suite passed: 4 files / 26 tests. App incremental TypeScript passed again.
- Playwright 1.64.0 collected all 58 affected Chromium cases. A real native launch was attempted for the 3 new viewport scenarios. Vite started on loopback, but Chromium 154 aborted before any page action with `process_singleton_posix.cc: socket() failed: Operation not permitted`. This is an environment blocker, not an application failure or browser pass; no permission bypass was attempted.
- Runtime: Node 24.19.0, Vitest 3.2.7, existing application dependencies reused from the profile-recovery worktree. This differs from the repository Node 22.23.0 CI runtime; exact full proof belongs to integration.

Final local verification: `npm run verify` passed (exit 0) on the exact integration HEAD/tree above: fresh app/Worker type checks, 8,197 passed / 54 skipped / 1 todo across 863 passed and 11 skipped files, and production build. The tracked inputs, 19,305 installed files, generated Worker runtime declarations and relevant environment inputs matched before/after. Existing compatibility tests generated an archive-only `.cache/j1-old-worker` output; that output is retained with evidence and is not part of the PR. Node 24.19.0 differs from CI Node 22.23.0, so native CI remains required. The post-integration create/subject/approval projection focused suite also passed (49 tests).

Next: publish a draft PR to admit existing native CI, temporarily including the already approved predecessor dependency; then narrow the review base and confirm only the 30 feature files remain. Parent review accepted both review findings. Native browser acceptance and the parent’s production Rules confirmation remain gates before main integration.

## Exit criteria

Focused unit/integration and owner-denial tests; canonical schedule reference roundtrip; new and edit flows; compact responsive CSS; exact-diff review. Root coordinates broad verify/build and browser verification. An unavailable browser or emulator is a verification blocker, never a passing result. Browser acceptance must be established in CI before release. Publication is approved; new production Rules access remains a separate merge gate.
