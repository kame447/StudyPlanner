# Class detail, attendance, and associated schedules

Status: draft PR, motion-enabled dialog coverage correction under verification
Updated: 2026-10-13
Branch: `feat/class-detail-attendance`
Base and initial HEAD: `98f3c324b5320d38294905c858ce1d2310209312`
PR: #635 (`feat/class-detail-attendance`), currently draft. Branch/PR publication and verified main integration are approved; owner-only access for the new production attendance collection still requires the parent’s specific confirmation before merge triggers Rules deployment.

## Request and scope

The user requested a clearer lesson editor, attendance management and lesson-related schedules, with the four supplied screenshots as functional references rather than a layout to copy. The entry should show a compact lesson summary, attendance counts/history and schedules. Forms appear only after an edit/add action.

## Ownership and boundaries

GitHub main, open PRs, related issues and all available branches were checked before implementation. No existing attendance implementation was found. PR #541 remains the owner of occurrence cancellation/Undo and day-timetable controls; those responsibilities are unchanged. Issue #483 is the existing small-UI umbrella, not an attendance persistence owner. This record owns the feature and PR #635 verification.

- Attendance is independent from study Actual records and cannot affect studied-time metrics.
- One attendance record per authenticated owner, immutable lesson ID and date; status is correctable. Renaming a lesson must not lose records.
- Associated schedules use existing Plan → canonical ScheduleEvent persistence, with an optional lesson ID reference. They do not masquerade as timetable occurrences or introduce another calendar authority.
- Attendance repository reads only the open lesson, rather than expanding startup reads.
- Rules changes remain a candidate: no production deployment or expanded access has occurred. Before main merge, confirm the new owner-only production attendance collection access because main triggers automatic Rules deployment.
- Notifications are outside this slice because the current app has no reminder delivery implementation.

## Current checkpoint

Resume ownership: the existing branch/worktree was reassigned on 2026-10-13 without discarding its dirty implementation. Remote exact-branch PR and attendance-title Issue searches found no duplicate. Rules calendar validity and the explicit schedule-create boundary are implemented, tested, and accepted in parent review. The remaining work is native acceptance of the visual correction below and the production Rules merge gate.

Feature commit: `bab069db`. Initial full-verified integration HEAD: `f98610b4ebdc6fb6c16f8ba1e835b5c0199110eb`, tree `0cb8278947e56c0808530a6d8661e4a4d4e0ea18`. It normally merges main `782f3559` and the approved #626/#627/#629/#630 predecessor `341aa6f4`; the subject deletion/Undo fix is preserved. The subsequent Admin-only harness-routing correction and checkpoint were published as remote `3095bf320d1801d5dfe181a5de5dbf79b4242aee`, exact local/remote tree `d4d9e49fa3b673b738ee6748a6d03c4736d67614`. Native CI on that version passed fresh types, 8,197 tests, build and Rules. The visual correction below requires a new exact full and native run.

Implementation:

- A lesson opens a compact summary, attendance counts/history and related schedules. Attendance/schedule input opens only on demand. The editor keeps primary fields visible and groups optional lesson details behind a disclosure.
- Attendance has dedicated local and Firebase adapters with one record per owner/lesson/date. Firebase reads require a server snapshot and saves check the owned class in a transaction. Correction preserves creation identity; removal of a template does not erase attendance history. The new Rules grant access to the owner only, without an admin-access expansion.
- `classTemplateId` survives Plan draft editing, canonical ScheduleEvent conversion and repository reload. Timetable occurrence provenance is not reused.
- Existing editor save/deletion lifetime protections are retained. Both detail and editor have dialog focus/Escape handling.
- Added an isolated Rules regression to the existing demo-only emulator entrypoint, and a browser scenario covering 320/390/1280px, attendance correction, associated schedule persistence and rename/reload.

Verification at this checkpoint:

- 13 focused files / 144 tests passed, including all 15 existing editor lifetime cases, new persistence/UI tests, and related schedule authority/timetable regressions. Command: `DEV_LAN_HOST=127.0.0.1 node node_modules/vitest/vitest.mjs run --config vite.config.mjs --configLoader native --maxWorkers=2 --minWorkers=1` with the 13 affected test paths. Evidence: `class-attendance-evidence-20261013/attendance-expanded.log` in the parent workspace.
- Initial App TypeScript check passed (`--noEmit --incremental`, per-worktree cache); the later fresh full result is below.
- Initial browser collection: Chromium 58 cases across the new/affected three files; cross-browser 12 new scenarios. Collection began with isolated Playwright 1.62.1 and was repeated using canonical 1.64.0. Subsequent native execution and the visual-review failure are recorded below.
- The new Rules script and E2E scripts pass `node --check`; `git diff --check` is clean.
- The initial bounded offline lookup did not find Firebase tooling. A later shared-tooling inspection found existing Firebase CLI 15.33.0 and Firestore emulator 1.22.0. Using isolated demo-only configuration and normal permissions, the complete existing Rules entrypoint plus attendance passed (exit 0). Owner-denial, correction/history, calendar-month and leap-year validity were exercised; exact file hashes and command are in the evidence receipt. No dependency download, credentials or production deployment was needed.
- Review fixes: related schedules now use a small explicit create operation through the existing persistence-result projection boundary. Normal and recurring global editors remain untouched, and the promise waits for durable save. Four regression cases plus the existing attendance suite passed: 4 files / 26 tests. App incremental TypeScript passed again.
- Playwright 1.64.0 collected all 58 affected Chromium cases. A real native launch was attempted for the 3 new viewport scenarios. Vite started on loopback, but Chromium 154 aborted before any page action with `process_singleton_posix.cc: socket() failed: Operation not permitted`. This is an environment blocker, not an application failure or browser pass; no permission bypass was attempted.
- Runtime: Node 24.19.0, Vitest 3.2.7, existing application dependencies reused from the profile-recovery worktree. This differs from the repository Node 22.23.0 CI runtime; exact full proof belongs to integration.

Final local verification: `npm run verify` passed (exit 0) on the exact integration HEAD/tree above: fresh app/Worker type checks, 8,197 passed / 54 skipped / 1 todo across 863 passed and 11 skipped files, and production build. The tracked inputs, 19,305 installed files, generated Worker runtime declarations and relevant environment inputs matched before/after. Existing compatibility tests generated an archive-only `.cache/j1-old-worker` output; that output is retained with evidence and is not part of the PR. Node 24.19.0 differs from CI Node 22.23.0, so native CI remains required. The post-integration create/subject/approval projection focused suite also passed (49 tests).

Next: publish the full-verified visual correction to the existing draft PR #635, inspect new native images and all required CI, and confirm the feature-only diff after the already approved predecessor reaches main. Parent review accepted both original review findings. Native browser acceptance and the parent’s production Rules confirmation remain gates before main integration.

## Exit criteria

Focused unit/integration and owner-denial tests; canonical schedule reference roundtrip; new and edit flows; compact responsive CSS; exact-diff review. Root coordinates broad verify/build and browser verification. An unavailable browser or emulator is a verification blocker, never a passing result. Browser acceptance must be established in CI before release. Publication is approved; new production Rules access remains a separate merge gate.

## Native visual review correction

The first native Chromium/Firefox attendance scenarios passed, but image review found the inherited timetable drawer still used a translucent surface, reserved bottom-navigation space, and lowered the overlay to z-index 90. The new lesson detail/editor now has its own scoped overlay, uses the existing modal layer, an opaque theme-colored surface, and full viewport height with an independently scrolling body. No global navigation layer was changed. Native assertions now cover opacity, hit-tested coverage over navigation, contained scrolling, header actions, focus and Escape return in addition to persistence. The first images are evidence of the defect, not final visual acceptance. A new exact full run and native image review are required for this correction.

Pre-publication review found that relative RGB without explicit alpha inherits the origin transparency. The final scoped surfaces instead use the exact existing light/dark surface RGB values as opaque hex colors, avoiding a newer-syntax dependency or translucent fallback. An in-progress full was intentionally stopped (exit 130) before changing its inputs; it is not final proof. The replacement run records a read-only exact content snapshot and disables Wrangler metrics and tracking.

The opaque-surface correction passed full verification at local `9bfd38c4`, tree `4e0a3f22d0c566c998a710254183b7b04f731d86`, and was published as `adb325c4`. Main `c1f10455` then adopted all four predecessors; the normal local ancestry merge `3677d4bd` has the identical verified tree. The first normal-browser run reported 658 passed and one real input-focus policy violation: the new related-schedule form forced focus into a text field. That prop is removed, the existing source-policy test is unchanged, and the native scenario now checks that opening the form does not focus a text control. This final correction requires another exact full/native result.

The correction's first Chromium native run passed opacity and navigation coverage but hit-tested the header while the fixture's ordinary save notice was still above it. The captured image identifies the notice, not navigation or background content, as the obstruction. Stable dialog checks now wait for the existing 3600ms notice expiry without hiding UI, changing z-index, or weakening the header assertion. The native retry must still verify header controls, focus, dimensions, and persistence.

The next native run passed all three lesson flows in Firefox and WebKit desktop, including save/reload, header/focus/Escape, and captured detail/editor images. Chromium passed opacity, nav/header hit-testing, focus and scroll checks, then exposed a test-boundary error: its locked-root `clientWidth` includes the 15px empty stable scrollbar gutter, while the backdrop correctly fills the content area. Actual Chromium images show that gutter contains no lesson content or controls. Parent review accepted the opaque Firefox detail/editor images and clarified that safe content/navigation/control behavior, not physical viewport equality, is the requirement.

Three options were reviewed: preserve the observed safe gutter and measure the actual root content rectangle; extend only the backdrop; or force `100vw`. The first is the smallest, supported by native hit-tests/images; the second adds a paint mechanism without a functional benefit, and the third has engine-dependent viewport-unit/gutter semantics. The unneeded `100vw` candidate was not published and was reverted, restoring the exact already verified production code. The isolated native helper now compares backdrop coverage to the root rectangle and additionally rejects interactive controls in any reserved gutter. It retains full height, opaque surface, nav/header hit-testing, focus/Escape, document overflow and card/control containment checks. No root gutter, viewport measurement state, or shared navigation style was changed.

## Motion-enabled native acceptance

Published `32916021`, exact local `8cdb545e` / tree `32af44a7`, passed fresh local full verification (8,197 tests, fresh app/Worker types, build, identical tracked/installed/generated inputs) and native CI/Rules, Admin render, browser quality, the complete Chromium/Firefox/WebKit desktop/mobile matrix and visual regression. The ordinary motion-enabled Browser run `38474433935` ended with 651 passed and 8 failed; it is not accepted.

Five old editor checks still required the former navigation-reserving short drawer. They now require the approved full-height dialog and hit-test that it covers every navigation button, while retaining all lower-field trial clicks and hit-tests. The other three failures occurred after reload and immediate reopen: native images show the navigation above the lesson detail even though the card itself is opaque. The route's 150ms opacity fade creates a temporary stacking context; the reduced-motion matrix suppresses that fade and passed the same flows. Waiting longer in the assertion would conceal the real transient defect, while portaling both dialogs would unnecessarily widen this correction. The selected scoped CSS finishes the timetable entry animation only while its lesson dialog is present by setting its duration to zero. Its animation name and timeline remain unchanged, avoiding an animation restart on close. No shared navigation style or z-index changes.

The immediate navigation hit-test remains unchanged in strength and now reports geometry on failure. Native acceptance additionally requires route opacity 1, the scoped zero-duration rule, navigation usability after Escape, no restarted route entry, and repeat open/close with correct focus restoration. These changes require a new exact full run and motion-enabled native verification before publication acceptance. Production owner-only attendance Rules confirmation is still pending; no merge or production deployment is authorized by this checkpoint.

The scoped motion correction passed exact local full verification at `054f9368` / tree `9ecf47fb` (8,197 tests, fresh types, production build; all source, generated and 19,305 installed-file fingerprints unchanged). Before publication, main advanced to `f85a873b` with the approved event-color and compact-form changes. The existing attendance branch is normally merged with that main; the sole conflict is the cross-browser selection list, resolved by retaining both attendance and compact-form scenarios. Automatic TimetableView/editor-lifetime merges are inspected and retained. This combined content requires a new exact full/native result; the previous full proves only the pre-integration snapshot.

The intermediate main-f85 full was intentionally interrupted (exit130) when the parent confirmed the authorized release sequence was still underway. Final main `c32b0e27` / tree `e08d3b42` includes #631–#634; #628 remains open and is not an adopted predecessor. The same attendance branch now normally integrates that final main, preserving all existing and new cross-browser entries. Final acceptance uses the combined `main-c32-motion` evidence, not the interrupted intermediate run.
