# Unplanned study start checkpoint

Status: active, final integration and publication verification
Base: `3a1e60b9`
Branch: `feat/unplanned-study-start`
PR: https://github.com/kame447/StudyPlanner/pull/540 (draft); user authorized review-tested PR publication and main integration. Root owns publication coordination and main integration.

## Scope and ownership

Home always offers 勉強を開始. A study Plan is visibly selected before starting, with an explicit alternative for unplanned study. Class/other/empty Home launches unplanned study. Keep schedule inspection available without a second primary CTA. Reuse the timer and standalone Actual save/admission; never create a fake Plan or change persistent schema.

Root's current repository/Issue/PR preflight found no same-scope active owner. Issue #190 owns separate Pomodoro settings; Issue #483 does not own this new end-to-end flow. Concurrent HomeScene work owns only the plan prop passed into HomeScene, not the CTA.

## Design comparison

- Fake Plan: would reuse the signature, but creates false schedule identity and fails current linked-target admission. Rejected.
- Separate ad-hoc timer: could avoid touching linked behavior, but duplicates lifecycle/save/error state. Rejected.
- Explicit planned/unplanned target with existing timer and existing Actual command: preserves data boundaries and permits direct boundary tests. Selected.

## Verification / exit criteria

Implement and verify planless start, explicit planned/unplanned selection, optional owner-scoped material selection, local start date, pause/resume, close/reopen, double start/save, owner changes, linked-path preservation, and uncertain-save inspection. Run focused component/domain/persistence regressions and app/Worker type checks. The release owner coordinates a final full combined verification, publishes the existing branch as a draft PR after that pass, and follows browser/CI verification. Root alone performs main integration.

## Verified implementation checkpoint

Implementation is ready for integration review. Initial implementation commit: `37a31e9026c00be15a6a28086d837d2c1beb31b1`. The accompanying display follow-up adds the selected Plan occurrence date beside its time, so future association is visible before start. Its exact code/test input was verified before this checkpoint-only update. The initial staged source snapshot before documentation edits was `b0b00bfba6e7ba52eaa827a6c623a88a3832092f`.

Implemented:
- Normal Home has one primary 勉強を開始 action. Class/other schedule inspection is a native, named title button.
- Completely empty first-use Home also offers unplanned start before setup.
- A study Plan launch visibly presents この予定で学習 / 予定にない学習 with its occurrence date before the timer starts. Unplanned start supports no material and optional title, or an active same-owner material.
- Existing timer/mode/record flow routes typed targets to linked or standalone Actual commands. No schema, repository, fake Plan, or second timer is introduced.
- Owner replacement, stale callbacks, repeated launch/start/save, explicit retry after admission rejection, and uncertain-write no-replay are covered.
- Starting the unplanned timer captures the local date. Crossing midnight, including during a pause, preserves measured duration and edited fields and requires explicit start-day time adjustment. There is no automatic multi-day split; the next day's portion must be recorded separately. Existing planned date behavior is preserved.

Verification on the selected-date display checkpoint (`af0632f3`):
- Focused Vitest: 9 files, 192/192 passed; includes 15 new unplanned/empty-setup cases, existing Firebase Study Session lifecycle/material regressions, Home clock, Actual drafts/tracking, and owner/Actual/material admission boundaries.
- New component cases under `TZ=Asia/Tokyo`: 15/15 passed; under `TZ=America/New_York`: 15/15 passed.
- `npm run typecheck`: app and regenerated Worker runtime types passed, exit 0. Initial Wrangler logging-only path warning was resolved by setting `WRANGLER_LOG_PATH` inside this worktree; the clean run also exited 0.
- Playwright collection: 64 tests in 5 touched specs, including 4 new unplanned scenarios (390px / 1280px, complete empty-state save, class-title keyboard entry/material progress, and explicit unrelated learning). Collection is not execution.
- `git diff --check`: passed.

Evidence: local ignored `artifacts/verification/unplanned-focused-final-date.log`, `unplanned-types-date.log`, `unplanned-tokyo-date.log`, `unplanned-new-york-date.log`, `unplanned-e2e-collection.log`, and `unplanned-e2e-date-collection.log`. The four new E2E cases were collected again after the occurrence-date assertion was added.
Environment: shared installed packages from `studyplanner-home-live-clock-work/node_modules`, lock SHA-256 `0cc1f34fa1ead88aab107a9cd1f91e00575d514d45406a5ec452d98b71bfdbb5`, Vitest 3.2.7, Wrangler 4.143.1. Existing E2E dependency symlink uses Playwright 1.62.1; no package/install mutation.

Remaining: integration owner's independent review, full nonincremental `npm run verify` on final integrated content, real browser execution/visual inspection, CI and publication. Browser sockets in this executor are known blocked (EPERM); no repeated launch attempt was made. Do not describe collected E2E or focused tests as a browser/full-suite pass. Main integration is owned by the parent task.

## Integrated input-retention follow-up

Integration base: `820334b94352a6b16787104c93d212cb630d90a0` / tree `fb1264a0a5d0144ee4b2424852ac502972a532b0`. Own implementation/test files were compared with `af0632f3`; only the coordinated HomeScene plan prop was additionally present. Integrated focused checks passed 192/192 before the follow-up.

Independent review found no blocking issue, with additional read-only probes for owner replacement, rejected launches, committed-write acknowledgement loss with/without material, real completely-empty Home save/re-entry, and concurrent standalone material saves. A nonblocking input-preservation observation was accepted for this follow-up: a paused record → timer → record round trip must retain manually adjusted start/end times and the acknowledged midnight adjustment. Recalculation now occurs only when measured elapsed time actually increases after resuming. Content, notes and progress inputs remain intact in either case.

The exact code/test input accompanying this checkpoint passed:
- Focused: 9 files, 194/194 tests (`unplanned-time-edits-focused.log`).
- New session cases in Tokyo and New York: 17/17 each (`unplanned-time-edits-tokyo.log`, `unplanned-time-edits-new-york.log`).
- App plus regenerated Worker typechecks: exit 0 (`unplanned-time-edits-types.log`).
- `git diff --check`: passed.

All logs are under ignored `artifacts/verification/`. No heavy full verification or browser execution was added by this worker; the integration owner still owns those final gates.

## Release continuation

Resumed the existing clean branch at `21ac9413db4f784043292778739ebb674e5d2fcc` on 2026-10-08. This includes the scheduled-student aggregate bundle calibration `e22be3f3` and the Home title regression correction `3fe84e57`. The latter fixes a stale comparison of internal React test objects; it does not change production, runner or heap settings. Its focused proof and the earlier failed full run remain separately recorded in the tooling runbook.

Current GitHub preflight found no existing unplanned-study branch, PR or same-scope Issue. Reuse this local branch; do not create a duplicate release unit. Preserve final header and AI fixes through the scheduled-student parent before full verification. Day-timetable work depends on this branch and must not be merged upward into it.

The new unplanned E2E spec is included by normal Browser Regression. It now attaches successful 390px and 1280px start/record screenshots for explicit rendered UI inspection. Collection passed for all 4 cases (`artifacts/verification/unplanned-release-e2e-collection.log`); this is not browser execution. Browser Regression uploads those attachments through its existing artifact configuration.

Next: merge the final lower stack non-destructively, run focused checks and exact-content `npm run verify` in the coordinated heavy-test slot, publish a draft PR using the actual remote scheduled-student parent, then follow required CI and inspect rendered screenshots. No main merge is delegated here.

## Combined runtime verification

Merged scheduled-student `550898170edfa380165c28fc08816cfa60b0b0f4` without conflict. Compared the binary own-feature patch before/after that merge; it is identical. Verified clean HEAD `0d1b9e888073be18430864e4e766d75d6e0a4700`, tree `58df4fb96dd3b3e8c304ee44861bd3fb3f6adc5f`:

- Focused integration: 10 files, 206/206 passed, including Home student behavior and unplanned/lifecycle/material/Actual admission boundaries.
- Exact `npm run verify`: exit 0, fresh nonincremental app and Worker typechecks, 760 files passed / 10 skipped; 6,161 tests passed / 45 skipped / 1 todo; production build 9.10 seconds.
- `node scripts/ci/check-bundle-budget.mjs`: exit 0; all eight existing guards passed.
- Before/after HEAD, tree, clean status and both manifest SHA-256 hashes matched. All 237 installed locked package versions were unchanged; no dependency installation or heap adjustment.
- Environment: Node 24.19.0, Vitest 3.2.7, Wrangler 4.143.1; command-local `DEV_LAN_HOST=127.0.0.1`, `CLOUDFLARE_CF_FETCH_ENABLED=false`, `WRANGLER_SEND_METRICS=false`, all Vitest fork/thread min/max variables set to 1, local Wrangler log path. Test timeouts and assertions were unchanged.

Evidence: `/tmp/unplanned-study-verify/release-verify.log`, `release-exit`, before/after snapshots and locked-package files in that directory; focused log at `artifacts/verification/unplanned-release-integrated-focused.log`. The previous heap-OOM run remains failed historical evidence; it is not counted as a pass.

After this full pass, only the WebKit-mobile E2E selection and this checkpoint were updated: the new unplanned spec is added alongside every existing mobile target. All 77 cases across 7 mobile spec files collect successfully, including the four unplanned cases (`artifacts/verification/unplanned-release-webkit-collection.log`). This is configuration/collection evidence, not a WebKit execution or real-iPhone result. Runtime full verification remains the exact snapshot above; later runtime changes require re-evaluation.

Still pending: final lower-stack acceptance and publication identity, draft PR, required browser/visual/CI execution and successful-image inspection. Main integration remains with Root.

The later scheduled-student candidate `b335e8563cbb26dc2882b36e185c62556be9f1b9` adds only its verification checkpoint and mobile E2E selection. The shared selection was reconciled as a union: existing shared targets, AI composer, scheduled student and unplanned study are all retained. Mobile collection passed for 97 cases across 8 files (`unplanned-release-webkit-union-collection.log`). Application/Worker/runtime test/build inputs remain unchanged from the full-pass snapshot; these E2E-only additions still await real browser execution.

## Draft publication boundary

The release coordinator approved publishing this coherent implementation as a draft so its real browser checks can run in parallel with the pending header repair. Scheduled-student local `a34e5e1859a5c472efd61309fc235235b891da38` is merged; its verified remote identity is `b21a3b1ae55339271fc35e6d2f5228e77c876b77` (PR #539), with the same tree `b80c9f8e984d7a34a29ea77e97b3c81c7da666e0`. Use that remote commit as the sole initial publication parent.

The additional AI mobile-WebKit fixture correction changes only E2E handling of unsupported `mouse.wheel`; runtime/type/unit/build inputs remain identical to the full-pass snapshot. Syntax checks for the changed specs/config and all 97 mobile cases collected successfully; 237 installed package versions still match. This does not establish real browser success.

Known lower-stack blockers must stay visible in the draft PR: the 320×568 Home Today area compresses enough to clip its add action, and responsive-header golden images have not been accepted. Neither browser results nor main integration are complete. Do not mark ready or merge; incorporate the reviewed header repair into this same branch and re-evaluate its runtime verification before main integration.

## Header repair and visual continuation

Initial publication verified remote `65cd16c7e5a8d2af44f93fea223641cbd8aba8c7`, local `1612c72b5ff3a0cc97d95aace6cff841e6d7a1b4`, identical tree `eb15d606e7037dfa3303c41aa4e049f6da142737`, and the sole scheduled-student remote parent. Initial CI, UI Quality and Admin checks passed. Browser and cross-browser checks are still running; initial visual has two desktop passes and two mobile failures from the pending baseline changes.

Merged scheduled-student `1be06e187e6ae829e667a43d0e0d3b03b49389ec`, including header `026e3122` compact-Home runtime repair and reviewed mobile baselines, as `6a2a2f1b`. Retained all WebKit targets, including compact Home, scheduled student and unplanned study; 119 cases in 9 files collect. This runtime CSS change requires a new combined full verification; the earlier full remains evidence only for its stated snapshot.

Reviewed and adopted only the two mobile Home CTA baselines from the digest-verified initial PR #540 compact artifact. Compared with the accepted scheduled-student images, the sole light/dark difference is the deliberate `勉強を開始` text region; all other pixels match. The compact CSS does not apply at these 390×844 golden dimensions. Full provenance and preservation of the other six mobile baselines are recorded in `tests/e2e/UI_REGRESSION.md`. Do not treat reviewed goldens as a final Matrix pass.

Next: wait for the coordinated heavy-test slot, run full verification on the repaired combined runtime, update the same remote branch without rewriting history using the latest published student tree, then follow new CI and review the unplanned-session success images. Main remains unmerged.

## Repaired-runtime verification and WebKit investigation

The repaired runtime at `94044701b03c0c749c9d81cbce3b334bf029a69f` / tree `bbda36c0a7c7cec9dc2daa696eda2601a7e92ddc` passed exact `npm run verify`: exit 0, fresh app/Worker typechecks, 760 files passed / 10 skipped, 6,161 tests passed / 45 skipped / 1 todo, build 6.86 seconds. All eight bundle guards passed. The same Node/toolchain and one-worker settings were used, with all 237 installed locked packages and manifest hashes unchanged. During this run, the only worktree change was diagnostic logging in `tests/e2e/study-session-unplanned.spec.mjs`, which the full unit suite excludes and type/build do not consume; application/Worker/unit/build inputs and HEAD/tree remained unchanged. Evidence: `/tmp/unplanned-study-verify/final-*`.

Initial real browser evidence for `65cd16c7`: all four unplanned cases passed in Chromium; the class and explicit-planned-choice cases passed in mobile WebKit. The two completely-empty mobile-WebKit cases failed the unchanged outer-dialog horizontal-overflow assertion at 390px and 1280px. Do not classify this as fixed based on unit tests or screenshots alone. The main candidates are native input sizing, retained entrance-animation overflow and measurement/paint timing. The closed time-adjust details and apparently bounded inner pane weaken the native-input hypothesis; exact geometry is being collected.

The intermediate public commit `f6de617fbd3d23d5d97adf69cb4b40a30b53a2fb` retains the initial runtime and changes only that E2E file to log initial/after-paint geometry and reversible animation/input-width diagnostic probes while preserving the original failing assertion. Successful screenshots now use a real output path so the compact artifact contains them. Matrix run `37713672316` is pending. These diagnostics are not a new production fix or a relaxed overflow allowance. The final local header/golden integration has not yet been published.

## Bounded entry/swipe transform candidate

The diagnostic Matrix run completed with the same two WebKit failures and 290 other passes. On both attempts, the 390px dialog reports scroll width 780 while its pane is 390/390, and the 1280px dialog reports 2100 while its pane is 820/820 at x=460. Every visible descendant stays within the dialog. An additional paint, removing animation after the fact, and constraining native inputs do not change the reported outer width. The surplus is exactly one pane width, consistent with retained offscreen entry bounds; this rules out ordinary form intrinsic overflow for the closed-details failure. Chromium again passed all four feature cases.

The accompanying candidate replaces individual `translate` entry keyframes with the sum of entry offset and the existing swipe variable inside one `transform`. It uses backwards fill only, so finished entry no longer retains an animation effect over the base swipe transform. Reduced motion disables entry animation and transition. No new clipping, allowed-overflow increase, persistence or timer logic change is introduced. A proposal to disable animation only during the swipe class was rejected in independent review because removing that class could replay entry.

Regression additions explicitly cover motion/reduced-motion media, completed entry, pane/root/descendant widths with time adjustment open, drag's rendered position, confirm dismissal and an abort during the real CSS animation paused at 140ms. The abort test verifies animation identity/time, final resting transform, one entry only and bounded outer width without modifying production animation duration. Temporary diagnostic style probes are removed; geometry logs and file-backed screenshots remain. WebKit selection preserves all prior targets and adds the existing touch-swipe spec.

Independent read-only final audit found no static blocker; changed JavaScript syntax and diff checks passed. WebKit collection: 123 cases in 10 files. Focused session/material/gesture unit tests: 36/36 passed. Runtime/browser success for this candidate is still unverified. Header `60162069` and scheduled-student `3280a914` are incorporated, including the subsequent reload clock-fixture correction. Run the next full verification only in the coordinator's exclusive slot, then update this same PR and follow actual browser evidence before accepting the fix.

The fixed candidate `442d55bae54d0dfbfa518ead3136a84997e5e89c` / tree `67ef3c53e6a1bda5bd5a11c4275918c78b5632a7` has now passed fresh `npm run verify`, exit 0: 760 files passed / 10 skipped; 6,161 tests passed / 45 skipped / 1 todo; app/Worker full typechecks; production build 9.11 seconds. All eight bundle guards passed. The exclusive run used fork/thread min=max=2 with the same other command-scoped environment; before/after HEAD, tree, clean worktree, manifest hashes and all 237 installed locked package versions matched. Logs and snapshots: `/tmp/unplanned-study-verify/transform-*`. No source/test/config input changed during this run. The following checkpoint-only commit does not alter that verified input. Actual browser correction and strengthened swipe regressions still require CI execution.
