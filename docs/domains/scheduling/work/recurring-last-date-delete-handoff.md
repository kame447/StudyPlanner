# Final explicit-date deletion

Status: authorized release preparation on main `227410c6d4dea8688a414b88782d4420ef417530`. Original `c44bc514` and the prior uncommitted `5dbc0d58` preparation remain preserved. Publication and browser execution are pending the writer/CI checkpoint. The existing storage representation and IDs are retained.

## Bug and minimal correction

Deleting the only explicit date through the existing recurring scope dialog removed the final rule. `createPlanFromDraft` then normalized the empty rule set into a one-off and discarded its exclusions. A real Local repository save and fresh repository read reproduced the deleted occurrence returning.

The single-delete helper now retains its existing rules only when removing that date would empty the rule set. The existing excluded date suppresses the occurrence. Every nonempty result is unchanged. Plan/series/Actual IDs, schema, repositories, authorization, Rules, and editing behavior are unchanged. This is separate from the held empty-field persistence proposals.

Deleting the whole Plan instead was rejected because it would cascade unrelated historical Actuals. Changing the shared normalizer was rejected because it would broaden one-off storage semantics. Retaining the final existing rule is the narrow correction.

## Ownership and current PR audit

The official 2026-10-18 07:38 inventory has 25 open PRs and no ordinary calendar/recurrence PR. Historical #659 is merged. #777 is externally owned; its menu/press/action helper and all UI source are untouched here. The current old-client empty-field migration decision remains pending. No Issue/PR/remote branch was created for this local correction.

## Original candidate verification

- Initial real Local save/read regression failed, showing one reappearing occurrence with empty rules and exclusions. The minimal fix made that regression pass.
- Final domain/repository group: 34 passed across five files. Covers explicit-date and override variants, sequential date deletion, preserved future/past values, raw duplicate target Actual deletion, other-day/other-owner Actual and progress source preservation, and rollback/retry for either storage write failing.
- Final real React hook group: 31 passed in one file, including scope confirmation, live state and fresh repository read. Total distinct related cases: 65 across six files. Existing hook test prefix is preserved except its additional import.
- A separate exact old-main loader uses two independent module caches and 34 source inputs. Old readers preserve the final exclusion; old post-delete-read ordinary/all edits and a valid future edit preserve deleted dates through real Local save/read. The all-edit probe deliberately reuses the post-delete read after an ordinary title edit; it proves exclusion preservation, not preservation of that newer title. There is no valid future occurrence after deleting the only date, so future-edit coverage uses a multiple-date series with a remaining occurrence.
- Intermediate validation errors are retained: expected in-memory undefined properties differed from serialized storage; assertions now compare before/after stored rules. An initially misplaced hook test was corrected to top-level; all 31 hook cases subsequently passed. These were test-construction errors, not product failures.
- Fresh app typecheck: `npm run typecheck:app:full` exited 0; invocation/output and explicit exit-code file are preserved.
- Production build: not attempted because the reused installed dependency tree lacks the current Terser package. Native browser, live Firestore, and deployed behavior remain unverified.

## Compatibility and safety limits

This reuses existing fields and preserves IDs. It does not introduce the detached-plan Actual reference risk or null representation previously rejected. Old clients initiating their own last-date deletion still have the original bug until updated. A stale whole-record writer can still undo an earlier deletion, an existing lost-update limitation; this change does not claim conflict fencing. Local failure tests use one synthetic Storage handle, not a browser crash or cross-tab atomicity proof.

## Latest-main local preparation checkpoint

- Main `c7f373bc` includes the current Week radial action menu. The composition is conflict-free; the original domain correction, domain regression and hook regression are byte-identical to `c44bc514`. Every unrelated main file is retained. There is no persistence format or Rules change.
- Nine directly related files passed, 119 tests total: the original six domain/repository/hook files plus ScheduleItemActions, useScheduleOccurrenceActions and scheduleOccurrenceMutation. Fresh non-incremental app typecheck passed. Production build passed in 12.67 seconds with the existing matching-lock installation; no package was installed or changed. Build warnings about large chunks remain warnings.
- The first test/build invocations stopped during Vite configuration loading because this execution environment cannot enumerate network interfaces. No test or production compilation ran in those attempts. The existing `DEV_LAN_HOST=127.0.0.1` override bypasses only the development URL auto-detection. The failed logs are retained separately from the successful invocations; no source, assertion or runner setting was changed to pass them.
- One logical browser regression was appended to the existing yearly-quick-entry spec. It seeds a final explicit-date Plan, a separate Plan, the target Actual and an earlier Actual. Through the real Week keyboard menu and recurring scope dialog, it checks single deletion, preserved Plan/series identity and final rule, the excluded date, removal of only the target Actual, unchanged other Plan/history, and non-resurrection after a real page reload. This is the keyboard route at Chromium 1280px and mobile WebKit 390px, not touch-gesture coverage.
- Definition collection succeeded once for each existing project: four definitions per project, comprising three unchanged existing cases and the new case. Syntax and diff checks passed. No browser, live Firestore, CI or deployed execution occurred. Collection is not runtime acceptance.
- Exact invocation, exits, pre/post source and installed-input hashes, collection JSON and original failure logs are stored in the current preparation evidence. The only installed-tree delta is Vitest's generated result cache; package files and the browser runner remain unchanged.

## Next checkpoint

The 2026-10-18 preparation completed independent source/test review without a source blocker. Original 65-case and old-client six-invariant evidence remain historical snapshot results; those runs do not extend stale-writer, cross-tab, or live Firestore guarantees. No recurring empty-field migration implementation is included. The current release checkpoint below supersedes its local-only publication status.

## 2026-10-19 release preparation

- Latest official main `227410c6` still contains the original final-date normalization defect. The six-path candidate is composed onto that main; the domain fix, domain/hook regressions and Week native body are byte-identical to the reviewed `5dbc0d58` preparation. README is the latest main text plus the existing work link. No external AI change is modified.
- Current ownership preflight found no direct overlap in 20 open PRs. The single-date correction remains separate from the held recurring empty-field migration design.
- Fresh current-main verification passed: 119 tests across the same nine related files, non-incremental App types, and production build (Vite 13.61 seconds). All 2,939 tracked inputs were identical before/after execution. Existing matching-lock dependencies were reused; the only installed-tree change was generated Vitest result cache. No assertion, timeout or runtime configuration was changed to obtain these results.
- The existing native spec, both project configs and fixed-clock/startup helpers are unchanged from the prior collection. The original eight identities (six existing plus the new Week case in two projects) are bound without repeating collection. Actual browser behavior remains unverified until ordinary CI completes.
- All 34 old-client probe inputs still match their exact old/current module snapshots; the six original sequential Local invariants remain applicable within their documented limits. The original probes were not re-executed. The changed current-main Actual upsert optimization does not change this recurring batch-delete path; its prior acceptance is separate.
- Only this handoff was changed after execution to record outcomes. Source/test composition and the original six-path candidate remain preserved for independent review. Publication and ordinary CI are the sole writer's next step; merge acceptance still requires the new Week browser path and source-bound checks.
