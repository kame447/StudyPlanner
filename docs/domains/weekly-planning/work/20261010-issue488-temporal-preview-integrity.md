# Issue #488 — Accepted temporal constraints and preview integrity

Status: active / reviewed 14-path implementation; revision 2 verification pending
Updated: 2026-10-10 06:00 UTC
Owner: Issue #488 root coordinator; temporal-preview implementation worker

## Scope and checkpoint

- Issue: https://github.com/kame447/StudyPlanner/issues/488#issuecomment-6093252062
- Preserved source: PR #563, `e901fa843371d6a313b77f007bcf274a88d96da5`; read-only.
- Active branch: `fix/issue488-temporal-preview-integrity`; no pull request.
- Original base: `9f0e0911ba1dbd9caca9836b613a8c438647fc09`; current HEAD: `4bf4ad167ff9d07c740d0a732f9508e92e2f1765` after the coordinator-authorized main fast-forward.
- Current authority: coordinator-approved production implementation and static test preparation; further execution awaits the shared heavy slot. No commit, publication or merge. Historical preparation sections below are superseded by the latest dated checkpoints.
- Unit C owns accepted typed temporal constraints reaching scheduler placement. Limited F2 owns invalidation of an existing preview when its accepted placement basis changes.
- U0 storage preservation and A correction/write-reference integrity are separate active owners. Neither is integrated into this base. Final C release must reconcile A against current main and re-verify the combined behavior.

## Preparation and verification boundary

Inspect the actual main/source tests, reuse existing helpers, and prepare small fault detectors for:

1. A preferred weekday absent from a short accepted period must not silently disappear; compare task and plan-wide typed forms.
2. An unaccepted UI fallback week must not be mistaken for an accepted period when deciding whether a hard-date scope needs clarification.
3. Accepted scheduling changes invalidate old preview during questions; unchanged graph, unrelated new unresolved work and uncertainty-only lifecycle changes retain a legitimate preview without promoting or saving it.

No raw-language reinterpretation, architecture mode, prompt, renderer authority, busy/all-day, quantity splitting, capacity retry, schema or storage changes belong to this preparation.

## Prepared test-only diff

- `semantic/weeklyPlanningHardDateContradictionCompilerV5.test.ts`: reuse its one-hour task and lifecycle fixture; add seven table-expanded tests. Cover task/plan preference outside a short accepted period (canonical Friday; absolute prior date remains a nonblocking fallback control), an in-period control that must produce one actual time-bounded candidate, accepted versus UI-only nonempty horizon with the same hard deadline, and hard Friday grounded inside next week rather than the request week.
- `application/weeklyPlanningStableV5PreviewRepairIntegration.test.ts`: retain the existing runtime regression for unrelated new work and a no-op reply. Add seven table rows at the existing result-projector/staged-graph boundary: task temporal add/replace/remove, plan-wide availability add, unchanged placement facts, uncertainty-only cleanup, and unrelated new task. Reuse its initial preview document and runtime setup; do not add a shared fixture or framework.
- Test additions: 14 table-expanded tests, with a canonical-weekday scope check and absolute soft fallback control in each task/plan row. This count is a preparation inventory, not a pass count.
- Production, runner/config, dependency and shared-helper changes: none. Test files: +261 / -1 lines. Canonical work checkpoint is the only new file.
- Static `git diff --check` succeeded. Typecheck, test collection, runtime tests, build, browser, model, save and CI were not run. Dependency preparation is complete as described below.

Expected baseline faults (unexecuted): dropped out-of-period preferences, missing plan-wide preference projection, accepted-period hard-bound classification / weekday grounding, and stale-preview preservation for changed accepted placement facts. Unaccepted UI horizon and unchanged/uncertainty-only/new-task cases are safety controls; they must remain passing rather than being weakened during extraction. An initial failure before the intended assertion must first be classified as harness/fixture or production evidence.

Next: await coordinator authorization for the two-file focused red/control run. No implementation or publication is authorized yet. Later release work must connect the same accepted facts through runtime/controller/reducer, renderer truthfulness, approval rejection, trace persistence and real-model/UI/save gates; these projector/compiler probes do not certify those boundaries.

Exit for this preparation: exact test paths and dependencies documented, production tree unchanged, no tests executed, and run request delivered. Full implementation/release still needs focused regressions, trace persistence, exact-content verify, applicable real-model/UI/save/reload and CI gates plus independent review.


## Dependency preparation (no runtime verification)

With coordinator authorization, copied the existing A worktree's `node_modules` into this worktree as independent files. No install/update and no shared dependency changes. The two worktrees have identical package.json and package-lock.json bytes. The repository locked-toolchain guard confirmed the same 235 installed locked packages before and after copy. All 235 installed package.json files are byte-identical and have different inodes. Disposable .vite/.vite-temp/.cache directories were excluded; no cached result is verification evidence. This checks installed identities and metadata, not every executable byte.

No tests, collection, typecheck, build, model or browser runs have started. The root coordinator still owns execution-slot authorization.


## Implementation hunk preparation

Prepared a bounded implementation plan mapping all 14 probes to accepted-window context, shared date/preference compilation and existing result-projector retention. No production changes or runtime checks. The plan preserves current absolute soft-preference fallback: availability emits a nonblocking outside-window diagnostic; task preference has no existing equivalent diagnostic to assert. This replaces the preparation's unsupported blanket blocking expectation with an authorized control while retaining the canonical-weekday red detector.

Window grounding remains in application TemporalContext, as the existing architecture contract requires. Proposed context carries a fact-ID-bound accepted range separately from UI fallback; one narrow SemanticTurn pre-turn temporal-wiring hunk may add a 13th production path beyond the original 12-path candidate and requires coordinator scope approval before implementation. Failure-time preview preservation remains owned by controller/fail_turn. Exact preview-membership tracking is not introduced; old-active-task comparison can conservatively invalidate after multi-turn additions of unresolved new work.


## Approved narrow design and extra preparation

The coordinator approved the temporal-only SemanticTurn wiring scope. Result projection will reuse the existing active scheduler graph view and existing canonical serialization; the proposed independent per-field scheduling projection is withdrawn. Retention scope remains old active tasks plus global conditions. Unknown future fields must remain compared, and array order is preserved because existing placement can use it.

Prepared eight more rows in existing suites: two one-sided clocks plus date-only control, known/unknown named period before workload, and cross-midnight/notBefore/24:00 boundary agreement between both availability consumers. Added coverage is now 22 rows across three existing tests (+337/-2), with no shared fixture or production changes. No runtime checks have run; the baseline slot is still coordinator-controlled.


## Authorized main baseline result (2026-10-10 04:54 UTC)

The coordinator authorized the prepared three-file focused baseline only, with one worker. Exact unchanged main HEAD and test diff produced 14 expected assertion failures and 12 passing controls (26 total, 22 added), in 11.13 seconds. All four original tests passed. Added unchanged/uncertainty-cleanup/unrelated-task retention controls passed. Failed boundaries: weekday outside accepted range, plan preferred projection, accepted hard bounds and weekday grounding, one-sided clocks, unknown named period before workload, cross-midnight interval consumers, and changed accepted placement facts retaining stale preview.

The first attempt stopped before collection due to Vite network-interface enumeration. The second used the existing supported DEV_LAN_HOST=127.0.0.1 override and collected/completed every test; no source/config/security changes. Both logs are retained. The 235-package locked-toolchain guard passed before and after; patch and test inputs remained byte-identical.

Important: absolute-date soft fallback assertions are behind the expected failing weekday assertion in two rows, so they were not reached. They must not be reported as verified by this run. Preserve their expectations and obtain independent control evidence in the next authorized focused run. Downstream assertions after any failed detector are similarly unverified.

Heavy execution slot was returned immediately after completion. No production edits, full/typecheck/build/browser checks, commit or publication occurred. Await coordinator review and implementation authorization. Earlier unexecuted/preparation-only sections describe historical checkpoints, not the current baseline status.


## Authorized implementation and first focused result (05:08 UTC)

Coordinator approved H1–H4 after main baseline. Production now spans 14 paths: the approved 13 plus a single AvailabilityResolver consumption hunk for the shared discrete-date snapshot. No source files were copied wholesale; only temporal responsibility hunks were selected. PlanningEvaluation preserves grounding reconciliation before the authoritative accepted range and one date snapshot. Absolute/relative/request-clock/recurring meaning stays outside the accepted canonical-weekday branch. Existing active scheduler view and canonical serializer own F2 comparison; array order and unknown domain fields stay compared.

First focused run fixed the exact input at 05:05 UTC: 60 passed / 2 failed across six suites, 8.73 seconds. All original 14 red detectors passed, plus absolute soft fallback, request/accepted weekday and discrete multiweek controls, frozen/rejected grounding, and F2 unknown-field invalidation/source-only retention. App typecheck then exited 0 on the same unchanged input. No worker/full/build/browser/model/CI verification occurred.

The two failing new trace tests are fixture issues: estimated 12 pages × 5 minutes = 60 receives existing 1.1 safety buffer and five-minute upward rounding, giving 70 allocated minutes; date/time were correct. The old in-memory trace repository incorrectly requires userId on a v2 diagnostic, which deliberately omits it. The amended tests assert both base60/allocation70 and use existing RemoteRepository + mock API + actual Worker preparation, without weakening production permissions/validation. These amendments are not yet run.

Prepared one controller/staging/reducer flow for provider-throw preservation → accepted temporal condition invalidation → explicit condition removal → recomputed preview → stale approval rejection. Prepared the existing grounding runtime fixture's newly rejected versus still-valid frozen range control. These additions are unexecuted. Production hashes remain exactly those of the first focused run; independent static review is running against that fixed input. The heavy slot was returned at 05:07 UTC and further execution awaits coordinator permission.

Remaining gates: amended trace tests, controller/approval flow, grounding runtime symmetry, relevant existing regression selection, A/latest-main reconciliation, exact-content full verification, independent review, applicable real-model/UI/save/reload and CI. No commit/push/PR/merge yet.


## Independent review corrections prepared (05:20 UTC)

Two F2 basis omissions were found independently: a rejected relative-window grounding can change its resolved dates without changing active graph facts; a newly added fixed-interval task can reserve time globally even though new movable tasks are intentionally outside retention comparison. Coordinator approved bounded changes in the existing ResultProjection and TemporalContext files only. The previous accepted descriptor requires explicit or frozen evidence and is never reconstructed from the current clock. Current accepted descriptor uses the existing resolver. Missing relative evidence or an expired range invalidates conservatively; explicit absolute range and no-window fallback remain valid controls. Existing TaskCommitmentResolver owns fixed_interval semantics, including blocking soft/unknown values and recurrence expansion, so only new fixed-interval-owning task IDs join the existing view comparison. No new state, serializer, calendar interpretation or production path.

Prepared symmetric projector rows for same-range acceptance/rejection, changed-range rejection, missing/expired frozen evidence, explicit range without grounding, same-day open versus 24:00-ended range, no accepted window, and new fixed/unresolved commitments. Added two instrumented runtime probes with a real initial graph finalization: reject the old relative range on the following week and observe hard-scope repair; accept a fixed appointment overlapping the old candidate plus another effort-incomplete task and observe repair. Both must explicitly invalidate retention while leaving committed graph mutation to the controller.

Static review found the same-day control's inherited August 23 hard deadline outside its August 11 accepted range. Its deadline now matches August 11 so the initial preview can exist; the retention assertion is unchanged. These additions and review corrections are unexecuted. First-focused/typecheck results describe earlier content only. The production 14-path and seven test-file hashes are fixed in the shared revision-2 receipt. Further verification requires a fresh coordinator slot.


## Second focused result (05:24 UTC)

Coordinator authorized exactly the seven modified suites, one worker. Fixed input patch SHA-256: 720d97804c1d4717453bdbaf3efb42cba4f9d97295c3e90e1f1f00360a40dc1e. Result: 79 passed / 1 failed, 80 tests, 7.84 seconds. All original defect detectors, new grounding/fixed-commitment runtime detectors, symmetric retention controls, and both actual trace/outbox/Worker-preparation probes passed. Every source/test input remained byte-identical during execution; the 235-package locked guard passed before and after. Heavy slot was returned immediately. App/Worker typecheck and full/build/browser/model/CI checks were not in this slot.

The one failure is the new controller test's uncaught injected ordinary error. The existing controller dispatches fail_turn, performs failure cleanup, then deliberately rethrows ordinary errors (weeklyPlanningTurnController.ts:396–436). The fixture now asserts rejects.toThrow for that exact injected error rather than awaiting success. Its preview/intake/graph preservation assertions and all later temporal invalidation/recomputation/stale approval assertions remain unchanged and are unexecuted beyond this point. No production change was needed. Current production remains review revision 2; the amended test requires a subsequent authorized run.


## Latest-main integration (05:41 UTC)

Fetched main directly into the private C clone and verified FETCH_HEAD exactly 4bf4ad167ff9d07c740d0a732f9508e92e2f1765. Its one new commit, PR #565, changes README, Worker domain-origin configuration, and the matching Worker regression test. All three paths are disjoint from C. Before the ordinary fast-forward merge, saved the complete dirty patch and a 22-file archive. Afterward, every dirty C file remained byte-identical and all three upstream paths matched their exact commit blobs. Package/lock are unchanged. Preserved source remains clean at e901fa843371d6a313b77f007bcf274a88d96da5. No reset, rebase, forced operation, new commit or publication.

No verification has run on this integrated base. Next runtime execution will use coordinator-selected Node 22.23.0. The corrected controller test remains unexecuted; earlier Node/runtime results remain historical evidence for their exact receipts. A and U0 are still separate responsibilities and must be reconciled before final release.


## Node22 focused completion (05:56 UTC)

The coordinator authorized the same seven suites on latest main4bf using Node22.23.0. Fixed patch SHA-256: 316ebab496629dc1199bd3f61ffe9d03d8e394ffd491a3960f0dc728881483fb. All80 tests passed, seven suites,9.10 seconds. The formerly unreached controller assertions now passed: ordinary provider-error preservation, accepted temporal invalidation, explicit correction/recomputation, fresh approval eligibility and rejection of old approval. Inputs remained identical;235-package guard passed before/after. Heavy slot returned immediately. App/Worker typecheck, full suite, build and browser/model gates were not run in this slot.

Prepared an unapplied three-file verification-only proposal against A's a42ad827 actual-model/UI checkpoint. It reuses the existing bounded transport and real App/local repository harness for two C conversations within the existing six-turn/sixteen-call limit. A's workflow/harness is an explicit integration dependency and has not been copied into this branch. No browser, model call, new secret, production Firestore operation or publication was performed.


## Local A/U0 integration preparation (06:49 UTC)

Coordinator authorized preserving the independently focused C content and normally merging exact A+U0 commit 8ff702c74c1fd0e394b491d2d5db53444bf4a49d. Before Git changes, the current 14 production and seven test files matched the 80/80 receipt exactly; only this historical checkpoint document had changed. All 22 inputs were archived with hashes, and the original patch was preserved.

The requested independent C commit failed because this private clone had no author configured. The shell command did not stop on that failure, so the subsequent authorized fetch and normal merge fast-forwarded to 8ff while preserving C's staged inputs. There was no independent C commit. This ordering incident was reported immediately; the coordinator chose preservation checks and a current integrated snapshot commit, not reset/reconstruction. All 22 staged inputs were byte-identical to their archive, and all 49 disjoint A/U0 paths exactly matched 8ff. Subsequent command groups stop on errors.

This is an unexecuted local integration candidate, not main adoption or a new 80/80 result. The independent C 80/80 evidence remains tied to main4bf plus its preserved input receipt. No tests, typechecks, build, dependency copy, model/API or publication ran during integration. Next: apply the separately hashed four combined regression cases and reconcile the prepared C UI proposal against A's final renderer/outbox observer, then wait for an authorized execution slot.


## Combined four-case execution and fixture correction (07:31 UTC)

On local A/U0+C snapshot 6d36fbb9 plus the prepared four cases, the first combined focused run passed 82/84. The original 80 and two new controller cases passed. Two new grounding cases read full schedulerInput from an intentionally compact debug event and stopped before their remaining assertions; those assertions were not passing evidence. Fresh app typing also found nine test-only diagnostics: optional candidates were not explicitly narrowed, and Array.at was outside the ES2020 library. Both failure logs and unchanged-input receipts remain preserved.

The coordinator authorized minimal test-only correction. A call-through spy observes the real typed planning evaluation for the exact correction request; the compact trace's resolvedHorizon assertion remains. Optional candidates now fail explicitly before access, and last-array indexing stays ES2020-compatible. All intended pending identity, accepted range, discrete Friday placement, mutation, structured rejection, preview and stale-approval assertions are unchanged. Production14-path hashes remain revision2.

The corrected exact input patch aad5c636c4929c5eca3337044f80a2bd8bc057192726755b5158463aaa0ee0d9 passed all 84 tests in seven suites on Node22.23.0 / one worker, 17.44 seconds. All four combined cases reached their final assertions. Fresh app typecheck (no incremental cache) exited0. The 2,018 non-Markdown inputs and Node binary were unchanged, the existing 235-package lock guard passed before/after, and installed metadata matched the prior verified private-copy baseline. Shared receipt: temporal-preview-focused-5/receipt-result.json. This is semantic/application integration, not actual renderer/UI or live-model evidence.

Coordinator authorized fixing this source/test snapshot in a local commit and continuing in the same exclusive heavy slot with fresh npm run verify (app/Worker types, all tests and build), Node22 and both Vitest pool limits set to one. Full verification and actual model/UI are still unexecuted at this checkpoint. No C UI patch has been applied, and A's later ACK-repair verification-only change is not part of this snapshot.


## First combined full result and comparison ownership correction (07:57 UTC)

Exact clean local commit ec96f961e95d31ceae840b70a999c2518033b5cf passed fresh app and regenerated Worker typechecks, then failed the full test stage: 6,795 passed, two failed, 45 skipped and one todo (797 passing files, two failing, ten skipped; 905.23 seconds). npm run verify exited 1 and did not reach build. All 2,018 non-Markdown inputs, 235 installed package metadata/realpaths and Node/tool entrypoints remained unchanged. The full receipt and both failure logs remain preserved. The exclusive heavy slot was returned at 07:49:42 UTC.

The deterministic C failure is a responsibility-boundary defect: ResultProjection imported canonicalCandidateSerialization from a deliberately disconnected candidate-selection foundation. Its unchanged incoming-consumer architecture guard correctly rejects this dependency. The other failure is the unchanged contextual cleanup fixture's false readiness-failure row exceeding its 5,000ms watchdog (5,077ms observed). Its cause is unestablished; no timeout or harness expectation has been changed. An isolated unchanged observation is still needed.

After termination, the coordinator approved extracting the existing active duplicate-workload normalizer's private recursive JSON comparison into one import-free semantic helper with a boolean-only export. Original workload ownership/localId policy remains in its owner. ResultProjection uses that same helper while preserving JSON-wire optional normalization, task/global scoping and actual accepted-window comparison. Candidate-selection validation, byte/hash format, all consumers and architecture allowlists are unchanged. This adds two production paths beyond the original 14: the original normalizer and the extracted helper.

Prepared eleven additional rows in two existing suites: seven differential JSON-wire equality pairs against the old preview comparator, one original-normalizer nested-key permutation, and three real preview graph controls for key permutation, omitted/undefined optional data and ordered future-array changes. Existing unknown-field invalidation and all previous expectations remain. These edits have only static diff/ownership checks, not executed test or type evidence; execution is waiting for the next coordinator slot.

Evidence limits remain explicit: the two combined window rows use a direct executor and an artificial pre-turn question, not real renderer/controller presentation binding. Their stale-approval checks classify availability rather than invoking save. A later R0 integration must use real bound messages/current refs and tighten the revision-mismatch cause; the structured rejection row already passes through the actual outer executor and controller and preserves preparation/commit counts and prior state. No live model, browser, UI, Firestore or C publication has run.


## Comparison correction focused verification (08:02 UTC)

Independent review found no additional static blocker in the six-input correction patch 9f1c31ad3d94620c553879e14f31bb3e414ff63d1432284c3af015c5bd9ac3fd. On coordinator authorization, its exact content passed all 107 tests in ten suites: the existing C seven, the original normalizer plus differential equality controls, and unchanged dormant/StableV5 production-isolation guards. The actual preview graph's key-order permutation and optional-field controls retained preview; array-order and existing unknown-field changes invalidated it.

A separate command selected the two unchanged readiness-failure cleanup rows: both passed, false in 748ms and true in 1,747ms; the other nine tests were selection-skipped. The earlier full timeout was not reproduced, but its cause remains unestablished. No fixture, budget, watchdog or architecture allowlist was changed. Fresh app typecheck with --incremental false then exited 0. Commands and results are separate in temporal-preview-comparison-extraction/receipt-result.json.

All 2,019 non-Markdown inputs, 235 actual installed package metadata/realpaths, Node/tool entrypoints and generated inputs matched before/after. The heavy slot was returned at 08:01:55 UTC. Full verification has not been rerun on this correction; the prior failed full/build-not-reached receipt remains authoritative for its older snapshot. No model/browser/UI or external publication occurred. This checkpoint-only update follows the verified source/test snapshot and does not change those inputs.
