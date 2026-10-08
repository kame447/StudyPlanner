# Day timetable visibility and occurrence removal

Status: active; local final-content verification passed, draft publication and real-browser/Firestore gates pending
Branch: `fix/day-timetable-occurrence-controls`
Base: `3a1e60b9`

## Publication continuation — 2026-10-08 04:21 UTC

- The release coordinator explicitly handed the existing branch to a replacement release owner after the prior environment interruption. Current preflight re-read the repository rules, runbook, active checkpoint, open and closed related Issues/PRs, and the remote branch search. No competing Day occurrence-controls PR or remote branch exists; the existing local branch is reused without creating another Issue.
- Resumed clean local `a349143bb9e5dba2c85621a485c1701b53a0282b`, tree `140fc834145fec26c9d2e39e662327ed8507f983`. The exact diff from the final full input `5cb4bd236c012a5df712266947d8d79ed144db00` contains only Markdown changes; all 1,857 non-document tracked files are unchanged. The existing full log, fresh app/Worker commands, 6,215 passing tests, successful build, and exit-0 receipt were read again rather than inferred from the handoff.
- Rechecked the actual 237 installed package names/versions against the recorded installed manifest; all match. Manifest SHA-256 remains `c29a3d722f8517383da1cfc24acd5b7390b6dec3704fd08eb90fcd7c48588d23`; lock SHA-256 remains `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`. The documentation-only continuation does not invalidate that exact runtime proof.
- The release coordinator then authorized starting the Day gates before the final unplanned-study publication: preserve the existing published unplanned parent and current main as ancestors, publish the exact local tree as one main-base draft PR, and synchronize the new unplanned remote later without rewriting history. The draft must explicitly retain unaccepted unplanned-study scale/fade and WebKit behavior as pending dependency gates. Follow actual Firestore, Chromium/WebKit, rendered screenshots, and every required gate to terminal results. No real-browser or Firestore success is claimed yet. Main integration remains solely with the release coordinator.

## Resumed final-content verification — 2026-10-08 04:00 UTC

- The user explicitly approved publishing the accompanying change history, test results and verification-environment documentation to `kame447/StudyPlanner`. The previously blocked documentation blob succeeded on its authorized same-payload retry; no alternate upload route or personal schedule/image data was used.
- Merged final unplanned-study local `9613ab976016c996e6e57c10c720ecd7ad67bcdf` non-destructively. It includes the current shared-header/student integration and the final in-bounds scale/fade study entry candidate. The Day source hunks remain intact. WebKit selection is the complete union including Day and study-session swipe; configuration syntax and collection passed for 335 cases / 11 files.
- Exact clean input `5cb4bd236c012a5df712266947d8d79ed144db00`, tree `a2c90e7bf5dc9b5f8432795289cfab4f5ca4d033`, passed `npm run verify` with thread/fork min/max fixed to 1: fresh app/Worker checks, 765 files passed / 10 skipped, 6,215 tests passed / 45 skipped / 1 todo, 374.02 seconds; build 8.70 seconds. Separate bundle budgets passed (JS 2202.7 KiB raw / 592.1 KiB gzip, CSS 473.6 KiB raw / 79.5 KiB gzip).
- The 237 installed locked package identities, manifest SHA-256 `c29a3d722f8517383da1cfc24acd5b7390b6dec3704fd08eb90fcd7c48588d23`, clean source tree and command-local environment were recorded before and after. Evidence: ignored `artifacts/day-release/verify-5cb4bd23-input.json`, `verify-5cb4bd23.log`, and exit-0 receipt. No dependency, timeout, assertion, heap or persistent runner setting changed.
- Next: verify the latest actual unplanned-study remote identity, publish this same feature branch as one draft PR, then follow the exact-head Firestore, Day Chromium/WebKit, screenshot and all required remote gates. Earlier study-entry overflow and scheduled-student flaky observations are not considered resolved by local unit/build results; their final real-browser evidence remains required. Main merge remains with the root integration owner.

## Draft release input — 2026-10-08 01:24 UTC

The release coordinator approved publishing this coherent Day feature as one draft PR to run its real-browser and Firestore checks alongside the lower-stack releases. Main integration remains exclusively with the root integration owner.

- Merged lower local `1612c72b5ff3a0cc97d95aace6cff841e6d7a1b4` non-destructively. Its API-verified remote commit is `65cd16c7e5a8d2af44f93fea223641cbd8aba8c7` (PR #540), with matching tree `eb15d606e7037dfa3303c41aa4e049f6da142737`. Re-fetch the latest actual lower remote parent before initial Day publication because #540 is being updated.
- Also merged reviewed header `026e3122d022219dccf6cc753583e9e33b8fad4c` before running the new exact full check. Clean verified input: `a7e7c864694f10f2de29c7aabcb68f22d5b441e6`, tree `869c8189f7ce31fe095b920588cb0150e9ba9974`. `npm run verify` exited 0: fresh app/Worker types, 765 files passed / 10 skipped, 6,215 tests passed / 45 skipped / 1 todo, 399.34 seconds, production build 21.94 seconds. Bundle budgets passed separately (JS 2202.7 KiB raw / 592.1 KiB gzip; CSS 473.1 KiB raw / 79.5 KiB gzip).
- Input/environment receipt and terminal log are ignored `artifacts/day-release/verify-a7e7c864-input.json`, `verify-a7e7c864.log`, and `verify-a7e7c864.exit`. The same 237 locked installed packages and SHA-256 manifest `c29a3d722f8517383da1cfc24acd5b7390b6dec3704fd08eb90fcd7c48588d23` were checked before and after. Thread/fork min/max remained 2; no dependency, timeout, heap, assertion, or runner policy was changed.
- Then merged lower `94044701b03c0c749c9d81cbce3b334bf029a69f` as `65eb1ff834f8f6ac0b8d1bd0d4d650bfddde2e72` / tree `f439c8c60cdf626ca324a6e81ebbbf6f07943366`. Exact diff from the verified full input contains only three Markdown files and the two reviewed Home golden images reflecting the unplanned-study CTA. Runtime, app/Worker/unit tests, build configuration, dependencies, generated-input configuration and E2E assertions/configuration are byte-identical. The full runtime proof is reused only for that unchanged scope; changed goldens still need actual visual CI.
- Cross-browser configuration preserves the full union: shared/header, AI, compact Home, scheduled student, unplanned study and Day occurrence controls. Syntax and complete collection passed: 319 cases / 10 files, including Day mobile WebKit coverage. Actual Chromium/WebKit, actual Firestore emulator and rendered screenshot acceptance remain separate remote gates, not local passes.
- Earlier lower-stack blockers are retained as history: the 320×568 Home clipping has a reviewed CSS/scroll repair now included; the eight header mobile goldens and the two CTA-specific Home updates are included; the mobile-WebKit AI fixture no longer calls unsupported mouse wheel. Their exact combined remote gates remain pending, so neither ready-for-review nor main release is claimed.

## Mobile WebKit regression scope — 2026-10-08 00:56 UTC

Added the existing Day occurrence-controls spec to the `webkit-mobile` project. Assertions are unchanged: Day visibility, grouped-template cancellation and Undo, Plan/MonthEvent single-occurrence removal, Actual preservation, reload, and next-week continuity now collect under the iPhone device profile too. Configuration syntax and full cross-browser collection passed: 273 tests across 7 files, including both Day viewport cases. These are collection results, not actual WebKit execution. After the final lower-stack merge, retain all AI/header/student/unplanned-study specs and recollect the final union.

## Current-snapshot full verification — 2026-10-08 00:47 UTC

- With the integration owner's exclusive heavy-run slot, `npm run verify` passed on clean `f6dc67adc50ddaeab461ad9b34c1f148f6a640d9`, tree `dc6ebcba7747c45af0206eb45b92458eb02611b9`. Relative to `c3654491`, only the resumed checkpoint text differed; all runtime, tests, configuration, and dependency inputs were unchanged.
- Fresh non-incremental app and Worker checks, including regenerated Worker runtime types, passed. Full Vitest: 765 files passed / 10 skipped; 6,215 tests passed / 45 skipped / 1 todo; 208.34 seconds. Production build passed in 6.72 seconds. The separate bundle-budget gate passed: JS raw 2202.7 KiB / gzip 592.1 KiB, largest JS raw 753.3 KiB / gzip 212.1 KiB; CSS raw 472.6 KiB / gzip 79.4 KiB.
- The actual installed dependency tree contained 237 packages; every present version matched the lock and every non-optional lock dependency was present. Installed-manifest SHA-256 `c29a3d722f8517383da1cfc24acd5b7390b6dec3704fd08eb90fcd7c48588d23` was unchanged after the run. Environment additionally pinned Vitest thread/fork minimum and maximum to 2 and disabled npm update notifications/network installs. No dependency installation or configuration change was made.
- Exact input/environment receipt: ignored `artifacts/day-release/verify-f6dc67ad-input.json`; terminal log and exit 0: `artifacts/day-release/verify-f6dc67ad.log` and `.exit`. Post-run worktree was clean. `git diff --check`, both changed E2E/Firestore script syntax checks, and collection of six related Day/details/Month E2E cases also passed.
- This establishes the current combined content only. The lower-stack owners are still preparing further changes. Actual Firestore emulator, actual browser/visual verification, final lower-stack integration, PR/remote CI and main publication are still pending. The real-browser restriction remains unchanged and was not retried.

## Resumed release checkpoint — 2026-10-08 00:33 UTC

- Resumed the existing branch at clean `c365449160ece29340ced95d80475b8d72249bf1`, tree `6c1a6d385e7f2a58cb8888d03f8332108f5445bc`. Current remote Issue/PR/branch searches found no new owner for this scope and no PR for this branch. No additional Issue or branch was created.
- Compared all 31 implementation/test files against the original task manifest. Twenty-eight are byte-identical; the three changed files retain the Day hunks and contain only the expected lower-stack changes: unplanned-study provider props in App, drag-cancellation lifecycle in WeekView, and an EventTarget document double in the Day selection test.
- Ran `npm run test:run -- <nine focused Day/preference/occurrence/Firebase-ownership/AI-availability test files> --maxWorkers=2 --minWorkers=2`: exit 0, 9 files / 69 tests passed. The ignored local result is `artifacts/day-release/focused-resume-c3654491.log`. This is new exact-content focused evidence, not a full integration pass.
- Input dependencies were unchanged: Node 24.19.0, TypeScript 5.9.3, Vitest 3.2.7, Vite 6.4.3, React 18.3.1, Firebase 12.12.0, Wrangler 4.143.1; lockfile SHA-256 remains `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`. The previously verified installed tree remains linked from the live-clock worktree. Environment: `DEV_LAN_HOST=127.0.0.1`, `CLOUDFLARE_CF_FETCH_ENABLED=false`, `WRANGLER_SEND_METRICS=false`, worktree-local Wrangler log path.
- Final lower-stack integration, fresh full `npm run verify`, actual Firestore Rules/emulator regression, actual browser/visual gates, and publication remain pending. The existing Chromium socket restriction has not been retried or bypassed. The standard CI already executes the changed Firestore regression script, and Browser Regression already discovers the new Day spec.
- Next: wait for the unplanned-study release owner's final integrated HEAD, merge it without rewriting history, recheck the overlapping Day hunks, then run the final combined verification only in the integration owner's assigned execution slot. Only the root integration owner merges main.

## Current integration checkpoint — 2026-10-08 00:05 UTC

- Own implementation commit: `d3863ad3`. The integration owner merged the preceding unplanned-study parent `4a809b2f8be236216b3f712d2612fd9fc4daa71a` without rewriting history. Before this documentation update, the combined input was `875399a7dce2ff3d6643b64c131c8949c10a2fcd` / tree `cb89f8e7b398430c9f6d6f9db23b806b98e47d79` and clean.
- The integration owner checked that the independently owned App, WeekView and Day timetable-selection hunks remained present. This is source review, not a completed full test/build/browser pass for that combined input.
- The local focused results below cover the Day implementation. The final combined `npm run verify`, actual Firestore Rules/emulator regression, browser/visual gates and publication are still required. No PR or production acceptance is claimed here.
- The user approved this additional scope's review-tested PR publication and main integration separately from the earlier four UI fixes. Only the integration owner coordinates release and merges main. This scope is tracked in this checkpoint; no new Issue has been created.

The earlier local checkpoints below retain their original scope and verification boundary.

## Scope and ownership

Add an owner-isolated browser preference for timetable auto-display in Day, independent of the existing Month preference. Add an explicit single-occurrence removal from Day for timetable projections and recurring events, preserving all other dates and source identity.

Existing ownership checked through the documentation coordinator: #464 / PR #465 and #481 / PR #484 are merged; no active Issue, PR, or branch owns this additional request. Reuse the recurring Plan domain mutation introduced by #266 / PR #267. Publication and main integration were approved by the user on 2026-10-08 JST. The integration owner alone will direct publication after review and full verification.

## Investigation checkpoint

- The attached mobile Day screenshot was materialized and visually inspected.
- Before this change, Day timetable detail was read-only and Day month-event detail lacked deletion. Both now expose occurrence cancellation.
- Added optional template `excludedDates` after the integration owner reviewed all consumers. Display preferences need no persisted domain schema changes.
- Do not change drag/scroll behavior. The integration owner approved one independent WeekView actual-history fallback hunk; useTimelineDragController, drag locks, and common CSS remain unchanged.

## Exit criteria and next action

Implement settings and single-occurrence operations; verify owner/date identity, repeated clicks, persistence failure recovery, other dates, actual links, undo, and existing imports. Supply focused unit/integration evidence and E2E coverage. Integration owner runs the combined full verification. Browser Chromium launch is currently blocked by socket EPERM; do not repeat unchanged launches or bypass the restriction. No worker push, main update, or merge without the integration owner’s release instruction.

## Approved persisted exception impact

- Add optional `ScheduleTemplate.excludedDates: string[]`; absent fields remain equivalent to an empty list. No new collection or schema version.
- Firebase reads: `normalizeScheduleTemplateRecord` in `repositoryUtils`; local storage: `scheduleTemplates.v1` JSON in `localStorageGateway`. Both retain unknown optional fields today. Normalize valid ISO dates at these record boundaries.
- `normalizePlannerTimetableData` remaps term IDs using object spreads; keep exceptions when legacy terms are migrated.
- Writes: `saveScheduleTemplate` must preserve current exceptions when the editor produces a draft without them. Timetable/OCR editors retain their existing responsibilities.
- `applyTimetableMutation` already provides owner validation, Firebase atomic batch, and local recoverable writes. Grouped multi-period occurrences must update every candidate template in one mutation, never assume `sourceId` is one template ID.
- `isScheduleTemplateActiveOnDate` is the shared active-date rule used by `buildTimetableImportCandidates`; it feeds the common `ScheduleOccurrence` projection and weekly draft generation/placement availability. Consequently Day, Week, Month, Home, imports, and AI busy-time queries agree on canceled dates.
- Master timetable rows remain visible and editable. Date exceptions affect only occurrence expansion.
- Imported/moved Plans keep their existing `sourceDate` and `sourceId`. Saved Plan overrides continue to win over projected timetable entries. Deleting a projected template never passes a synthetic ID to Plan mutations.
- Firestore `schedule_templates` rules enforce owner CRUD and do not have a field allowlist. No rules/deployment or permission change is needed.
- No separate user-data backup/export codec was found; durable paths are the repository JSON and Firebase record normalization. Weekly planning session codecs do not own the timetable master.
- Existing recurring Plan deletion removes matching Actual records. A new Day-only cancel-occurrence action must preserve Actual identity/history instead of silently inheriting that destructive side effect. Existing series deletion stays unchanged.

## Final local checkpoint

Source/test manifest SHA-256: `24ed2fbe0a3c69af3ad2a928aad51eb2f80837a34375f6aca34d6235f1d4cd34` (31 implementation/test files; documentation excluded). Base remains `3a1e60b9`; use this task's local commit as the publication input rather than copying another worktree.

- Independent review: all identified blockers repaired. The reviewer reran 11 adversarial cases and 52 repository tests successfully, covering bulk template clear and Plan move races, unknown commit outcomes, failed repair admission, Firestore merge Undo, history metadata, AI busy inputs, owner ABA, and unrelated updates.
- Focused verification: 34 test files / 371 tests passed. The final cross-day presentation and Day UI run passed 10 tests after correcting a new assertion to match the existing date formatter. Runtime source did not change after the broad run.
- `npm run typecheck:app`: exit 0 on final source/tests.
- `npm run typecheck:worker`: exit 0, including fresh Worker runtime type generation.
- Playwright collection: 6 cases in the new Day controls, existing Day details, and Month visibility suites. `node --check` passed for the new spec and updated Firestore rules regression script.
- `git diff --check`: passed.
- Actual browser runs remain unverified: the executor's previously established Chromium socket EPERM blocker was not retried unchanged. The actual Firestore emulator suite is also pending integration execution. Mocked Firebase merge and owner-batch tests are explicitly not real Rules proof.
- No full suite or production build was duplicated here. The integration owner owns final `npm run verify`, Firestore regression, browser checks, publication, and main integration.

Dependency inputs: package-lock SHA-256 `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`. All 337 installed lock entries were checked against the expected non-optional versions before linking the existing dependency tree; it was not modified. Node 24.19.0, npm 11.9.0, TypeScript 5.9.3, Vitest 3.2.7, React 18.3.1, Vite 6.4.3, Wrangler 4.143.1. Runs used DEV_LAN_HOST=127.0.0.1, CLOUDFLARE_CF_FETCH_ENABLED=false, WRANGLER_SEND_METRICS=false.

Next action: integrate this reviewed patch with the current release parent, resolve only genuinely overlapping hunks, then execute the exact combined-content verification gates before publication and merge. No known focused failure or unresolved review blocker remains.

Scope audit: the 31 non-document files are the Day/settings surfaces, the shared owner-isolated preference, the occurrence command and date/Actual presentation helpers, the existing mutation/repository boundaries, the direct AI availability consumer, and their regression tests. The only WeekView change resolves retained Actual metadata by its occurrence date; it does not touch drag behavior. Existing assertions are retained. The Firebase test double now honors merge writes, and new assertions cover every independently reproduced defect. The only corrected assertion was a newly added cross-day copy test expecting a date format different from the existing formatter.
