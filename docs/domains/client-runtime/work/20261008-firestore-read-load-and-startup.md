# Firestore read load and startup investigation

Status: active; final local full verification passed; publication and automatic preview approved; browser CI pending and first-save Rules repair separately owned
Updated: 2026-10-08 UTC
Owner: [Issue #542](https://github.com/kame447/StudyPlanner/issues/542)

## Current checkpoint

- Active branch: `perf/firestore-read-load`.
- Base: `22847120386987329e2f034d6062d59694ef1180`. Verified implementation commit: `d48ad6c7d741d26db51eda03ef51f101a8c01614`, tree `631aec9f01a5ddfbffaed75ff343dcb17b2381dc`; the following publication-checkpoint changes are documentation-only. The exact 1,855 runtime/test/config input hashes and 336 installed-package identities match the final full run.
- The user approved publishing this independent PR and its automatic Cloudflare preview on 2026-10-08. The existing Issue #542 owns publication and CI tracking; current remote HEAD and PR URL will be recorded there after creation. Main integration, production data, production Rules deployment and billing changes remain excluded.
- Publication preflight at 2026-10-08 11:53 UTC found main unchanged at the base, Issue #542 open, and no existing remote branch or PR for this scope. The intended new PR is draft until its exact-HEAD CI and browser gates are evaluated.
- Scope: reduce redundant planner reads while preserving save, recovery, account isolation and fresh UI projection. The 2026-10-08 10:31 UTC request also includes investigating and repairing very slow application startup.
- A full planner load used separate Plan and MonthEvent queries over the same canonical collection. A combined owner-scoped snapshot is implemented locally. **The Emulator confirms that the SDK already shares the two concurrent queries: cold-start server Listen targets and returned document events are unchanged.** Do not claim startup server-read savings from this change alone.
- Approval saves now publish the confirmed Plan through the existing mutation/read authority rather than unconditionally reloading every collection. The mock measurement passes on both revisions with all 39 compared states equivalent. Five-item approval returns 552 / 4,467 / 43,617 fixture documents before versus 27 after for small / medium / large datasets; this is a logical SDK-boundary result, not billed reads.
- Startup tests reproduce an independent unbounded consent-status wait before any planner read. A 15-second total deadline and usable retry path are now implemented locally and tested. This bounds an error wait; it does not establish faster successful startup on a real device.
- **An additional real-hook Emulator check exposed an existing approval/Rules blocker:** both the base and candidate reject the first item when the transaction reads a not-yet-created approval-operation document. Zero new items are saved in that scenario. First-creation transport savings are therefore unmeasured; the passing mock does not establish that real-Rules success path.
- A separate ordinary-owner replay of five previously saved items succeeds under unchanged Rules: full-collection query targets fall **45 → 0**, while transaction reads and ledger writes stay unchanged. This verifies a real transport reduction for replay, not successful first creation or billable-read savings.
- An independent startup audit also caught and repaired a blank surface during preferences retry. That surface now remains visibly loading; the preferences API itself has not received a deadline.
- The first-save Rules defect is tracked separately in [existing Issue #51](https://github.com/kame447/StudyPlanner/issues/51#issuecomment-6058507615). Additional isolated Rules repair/verification was approved separately on 2026-10-08 and remains owned by Issue #51; no production Rules deployment is included.
- Final local `npm run verify` passes: fresh app/Worker typechecks, **6,204 passed / 45 skipped / 1 todo tests**, production build and all eight bundle budgets. The exact dirty-source and actual installed-dependency manifests are preserved below.
- Integration audit caught and repaired an activity-telemetry regression from the new combined getter. The final independent native-save/snapshot/telemetry run passes 17 tests.
- Next: publish the authorized draft PR from the verified runtime content, verify remote/local tree equality, and follow its exact-HEAD CI and automatic Cloudflare preview to terminal states. Local browser/visual acceptance and real-device latency are not established. Issue #51 owns the separately authorized first-save Rules repair; this branch does not change Rules or establish that fix.

This is an active execution record, not a new canonical storage contract. [Read projection recovery](../architecture/planner-read-projection-recovery.md), [client-first requirements](../spec/client-first-execution-requirements.md), [scheduled-event authority](../../scheduling/architecture/scheduled-event-authority.md) and [weekly-planning runtime](../../weekly-planning/architecture/current-contract-v5.md) retain their existing responsibilities. In particular, Issue #437 reconciliation safety and Issue #164 account/local-replica requirements are not replaced. Orrery/Issue #488 is outside this work.

## Evidence levels and safety boundary

Keep these results separate:

1. **Static evidence:** calls and dependency ordering read from a particular code revision. This can explain an amplification mechanism but does not establish real traffic or elapsed time.
2. **Mock logical reads:** SDK/repository calls and returned fixture documents counted by an instrumented test. Fixed fixtures and scenario boundaries make before/after results comparable. These are not network requests, server reads or billable reads.
3. **Isolated Emulator transport observations:** actual SDK requests, Listen targets and document changes against a local Emulator. SDK sharing can make two application calls use one transport target. An Emulator has no production billing meter.
4. **Production observations:** deployed build, real device/network timings, actual usage/quota and billable reads. These remain unmeasured unless separately collected and identified.

Use synthetic accounts and fixed fixtures only. Seed/reset operations are outside the measured scenario. An Emulator runner must select a `demo-` project explicitly, bind to loopback, avoid production environment files and credentials, and reject unintended external service destinations before the first request. The normal Firebase application configuration does not switch to an Emulator merely because one is running.

The user separately approved this branch publication and its automatic Cloudflare preview. No production-data access, real AI call, paid-service test, production deployment, main modification or unrelated work is authorized by this record. Branch publication can trigger the configured preview deployment; absence of a deploy step in Actions is not proof that a push is private.

## Baseline mechanisms at `22847120`

### Approval amplifies a full read

The app-level approval save calls the server save boundary and then waits for `loadPlannerData`. A full load requests ten projections, so K newly saved approval items can cause K full reloads. A failure after the server write can also be presented through the same save failure path. Preserve the distinction between a committed save and a failed display refresh.

- [App save boundary at the base](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/hooks/usePlannerAppState.ts#L306-L327)
- [Full read at the base](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/hooks/usePlannerDataState.ts#L483-L505)
- [Interruptible approval at the base](https://github.com/kame447/StudyPlanner/blob/22847120386987329e2f034d6062d59694ef1180/src/features/weeklyPlanning/planning/weeklyPlanningInterruptibleApproval.ts#L46-L70)

### Two projections read the same schedule collection

Separate Plan and MonthEvent getters query owner-filtered `schedule_events` independently. The migration decision is already shared, but its Promise is not the schedule-data snapshot. The repeated collection call is verified by the existing authority test. Whether it becomes two server reads depends on actual SDK/transport/cache behavior.

### Startup waits for broad data and other gates

Several user-owned collections are read without a date range or page limit. Those reads already start in parallel; adding their durations would overstate the critical path. Authentication/profile, consent, preferences, memory initialization, migration and asset/transport behavior are separate possible contributors.

[Startup timing guidance](../../../work/startup-timing.md) defines the existing opt-in phases and usable-Home boundary. Normal Home readiness, successful required reads and a working ordinary interaction are the outcome; splash disappearance or first paint alone is insufficient.

### Other load is not attributed to navigation without evidence

Ordinary day/week/month selection updates local state. No evidence currently identifies that navigation alone as a full reload trigger. Existing narrow owner-document listeners and their cleanup are not proof of a broad-listener leak.

Normal chat snapshots use local storage. Trace append, admin history/export and scheduled Worker jobs are separate load sources. They are not measured by a planner-hook fixture and must not be counted as zero in a production estimate.

The reported approximately **64,000 reads in one week** neither proves nor disproves exhaustion of a **50,000-read daily quota**: the distribution across days is unknown. The reported recovery time alone also does not identify the exceeded quota. Error details, daily/hourly usage, actual deployed versions and project/database settings remain unverified and are needed to establish the incident cause.

## Implementation and verification state

### One schedule snapshot per explicit read

`getScheduleSnapshot(owner)` returns Plan and MonthEvent projections from one canonical owner-filtered query. Each new explicit call performs a new read; there is no global or time-to-live data cache. Full loads consume the pair together. Reconciliation uses the combined read when its union needs both groups; a single-group repair retains its narrower getter.

The migration gate, rollout fallback classification and cross-owner protections remain in the existing authority. The combined snapshot is not a transaction over every planner collection and does not claim cross-collection atomicity.

The first combined implementation bypassed the observed repository's `app_active` emission because it was attached only to `getPlans`. An independent four-case audit reproduced two telemetry failures. Both read entry points now use the same successful-read, once-per-owner activity recording. The audit plus existing telemetry suite passes **13 tests** (`issue542-observed-green.log`), preserving the observation boundary without claiming zero telemetry load in the planner fixture.

A later independent run passes **3 files / 17 tests**: the two new native approval/snapshot audit files and the existing observed-repository suite. It covers a completed edit followed by duplicate acknowledgement, overlapping saves with failed repair and read-only retry, unknown commit response with canonical-identity retry, cancellation/resume, historical and future rows, recurrence/exclusions/busy projection, multi-day metadata, owner separation and a fresh subsequent read. No persistence/owner blocker was observed within those probes; multiple devices/tabs and live Firebase behavior are outside their guarantee.

Focused evidence:

- Command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/repositories/firebaseScheduleEventAuthority.test.ts`.
- Before implementation with the three new contract cases: 10 passed, 3 failed because the combined API did not yet exist. This is a contract red phase, not a production outage.
- After implementation: 13 passed, 0 failed; Vitest 3.2.7. Cases cover a single canonical query, new reads after completion, owner separation, read failure and a fresh retry.
- Transient logs inspected: `issue542-snapshot-red.log` and `issue542-snapshot-green.log`. Final acceptance must also record the immutable content identity; this focused run is not the combined full verification.
- Subsequent recovery-hook run: **24 files / 653 tests passed** (`issue542-hook-broad.log`). Final Firebase/local/facade/bootstrap suite: **4 files / 29 tests passed** (`issue542-final-snapshot-green.log`). App incremental typecheck passed (`issue542-typecheck-final.log`); this is not the fresh app/Worker/full-suite gate.
- Browser harness expectations now use nine full-load getters rather than ten and one combined schedule getter when both repair groups are needed. Both changed E2E files pass syntax checks. Browser execution is blocked before the application runs; see the capability evidence below.

### Approval result publication

The data hook's `projectPlanSave` begins existing writer tracking before the unchanged server approval transaction. An uncontended confirmed Plan updates the current projection without a full reload. A newer accepted read or another local mutation suppresses an unsafe late payload and requests the existing Plans/Todos repair group. Failure remains failure; the client does not infer success from an ambiguous response. The pending overlay is released in `finally`.

The focused approval run passes **7 files / 40 tests**, including 15 new app-hook integration regressions. It covers finalization-response loss and retry, an unknown save response followed by the same ledger retry, partial success, full reads on either side of acknowledgement, crossing ordinary edits, failed repair and explicit retry without another write, owner replacement, owner A→B→A, sign-out and unmount.

Command: `DEV_LAN_HOST=127.0.0.1 node ./node_modules/vitest/vitest.mjs --config vite.config.mjs run src/hooks/usePlannerAppState.weeklyApprovalProjection.test.tsx src/hooks/usePlannerAppState.weeklyApproval.test.tsx src/features/weeklyPlanning/application/weeklyPlanningApprovalFirestoreRepository.test.ts src/features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository.test.ts src/features/weeklyPlanning/application/weeklyPlanningApprovalRetry.integration.test.ts src/features/weeklyPlanning/application/weeklyPlanningApprovalApplication.test.ts src/features/weeklyPlanning/planning/weeklyPlanningInterruptibleApproval.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`.

An initial local-repository K=3 fixture changes 33 getter calls to 0 after approval saves, including a local timetable-canonicalization re-read in the baseline. This is a preliminary hook-boundary count, not the SDK count, canonical Firebase workload, server traffic or billed reads. Use the separate SDK measurement for the scaling table.

Final acceptance must cover all-success, partial save, cancellation, resume, duplicate/idempotent save, response loss, post-save projection failure and save/load overlap. Server transaction/ledger guarantees cannot be weakened merely to reduce reads.

### Startup diagnosis

The real root, policy HTTP client/hook, preferences, memory provider and planner/bootstrap hooks are tested with synthetic token/fetch/repository delays. Five initial tests pass. The App view is a readiness probe, so the end point is React-ready, not browser paint or a verified working Home.

| Synthetic input (milliseconds) | Cold-client example | Warm-client example |
| --- | ---: | ---: |
| Auth / token / policy | 120 / 180 / 700 | 10 / 10 / 80 |
| Preferences / profile / memory / planner | 400 / 600 / 900 / 800 | 30 / 40 / 90 / 60 |
| Observed React-ready time | 2,800 | 230 |

These are two deliberately different fixtures, **not a before/after optimization result**. The measured dependency is `auth + token + policy + preferences + max(memory, profile + planner)`. Each planner getter runs once and all planner reads start together in this fixture. Duplicate bootstrap and wholly serial planner reads are therefore contradicted for this tested scenario; they are not excluded for every real environment.

Before the repair, hanging token acquisition, fetch response, or response JSON parsing each leaves the consent phase pending at 60 seconds with zero preferences/profile/planner calls and no recovery screen. This reproduces a local indefinite-wait defect before Firestore planner reads. It does not prove that the reported production delay took this path.

The privacy-status GET now has a **15,000 ms total deadline across token acquisition, fetch and JSON parsing**, with cancellation. Timeout leads to the existing unavailable/retry screen; consent is never bypassed. Superseded refresh, unmount and owner change abort the old GET, and only the current request may publish a response even if the underlying action ignores cancellation. Consent-save POST and trace writes do not receive this timeout or automatic retry.

Retry also restores the outer splash while a new status check is pending. A new regression first reproduced a blank retry surface (9 passed / 1 failed), then passed after the root-shell correction. The final focused run passes **3 files / 40 tests**, covering startup latency, the existing root and HTTP/hook boundaries. The successful synthetic timings remain **2,800 ms / 230 ms**, so the observed improvement is recovery from a stuck request rather than accelerated successful initialization.

Integration corrected the older parallel-startup fixture to gate the combined snapshot rather than the removed full-load `getPlans` call. Its independent pending MonthEvent stand-in became a pending Actual read, preserving the readiness assertions. After that and the optional-signal type correction, the combined startup run passes **4 files / 69 tests**, exit 0 (`issue542-startup-combined.log`). The final full pass below also covers the later permanent preferences-retry regressions.

A later independent root/preference-hook probe revealed a separate blank state: reject the first preferences request, invoke retry and leave the next request pending for 60 seconds. Before the repair, the root rendered an empty `div` with no splash, preferences screen or Home (**1 red / 2 passed**). The outer shell now preserves the splash for that pending preference retry too. The independent follow-up passes **2 files / 8 tests** on root-source SHA-256 `4634bb297271d19964838a8db67695382f9fa1577a2fe42f36fc429e0089f5dc`, including the same 60-second pending state with one splash.

Those checks also cover caller cancellation during response/body handling, original error identity, timer/listener cleanup, a superseded request not clearing a newer deadline, and a late body rejection after timeout not changing the UI. They establish React structure and request lifecycle, not browser rendering or a time limit on the preferences API. Normal preference loading can still wait on that API.

Startup command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/components/StudyPlannerAppRoot.startupLatency.test.tsx src/components/StudyPlannerAppRoot.test.tsx src/features/weeklyPlanning/trace/weeklyPlanningTracePolicyRequest.test.tsx --maxWorkers=1 --minWorkers=1` (3 files / 40 passed, exit 0).

Continue comparing these explanations against the evidence:

| Candidate | Current supporting evidence | Evidence that would weaken it | Verification boundary |
| --- | --- | --- | --- |
| Broad/repeated planner reads dominate readiness | Duplicate schedule calls and unbounded per-owner lists exist | No planner call has started during the reproduced consent stall; planner calls already overlap in the synthetic normal path | Same fixture read counts plus ordered startup phases |
| Authentication/profile/memory ordering dominates | Consent/preference/profile dependencies exist; a hung consent status blocks all later gates | A real trace shows consent/profile settling promptly; memory already overlaps profile plus planner | Deferred gate tests and comparable timing traces |
| Asset loading, main-thread work or Firestore transport dominates | They can delay startup independently of logical query count | Build/browser timing does not place them on the critical path | Exact production build and same browser/network conditions |

A unit test can establish ordering or a removed dependency. It cannot establish how many seconds a real phone or network saves. Avoid an artificial delay-only speed claim and retain failed/hanging samples in any real timing comparison.

Additional normal-startup candidates were investigated without adopting unsafe changes:

- **Skip an empty timetable batch:** the Firebase adapter adds no reread, and the locked SDK already performs no commit for an empty mutation set. A probe records zero commit-handler calls versus one for a nonempty control. There is no established network wait or read to remove here.
- **Replace memory initialization's transaction with one server read:** a temporary candidate passes basic characterization and owner-lifetime probes, but a contention case changes the publication contract. The current transaction retries to revision 8; the candidate can return revision 7 before subscription delivers 8. Because equivalent commit-time freshness is not established, this candidate was rejected.
- **Overlap profile validation and planner reads:** the current serial boundary is confirmed, but bypassing it would also bypass the authenticated-owner check unless that responsibility is safely separated. No such change is implemented.

No additional safe successful-startup speedup was established by these probes. The retained startup fix concerns bounded consent-request failure and visible retry, while the cause and duration of the reported real-device slowness remain unverified.

## Before/after result ledger

### Mock SDK-boundary measurement

The harness executes the real app/data hooks, Firebase migration wrapper and schedule authority, and approval persistence repository against an instrumented synthetic SDK. It counts logical read calls, returned documents, missing-document calls, empty queries and transaction attempts separately; it does not simulate network deduplication or cache behavior. Authentication, profile, optional catalog, telemetry and backend cron are outside this planner fixture.

Each revision passes five measurement tests. All **39 dataset/phase comparisons** have equivalent normalized UI data, recurrence/multi-day projections, selection state and final persisted maps. Historical recurring exceptions, a date-spanning event, an old yearly event and another owner's excluded row are retained.

| Initial owner fixture | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Plans / MonthEvents | 24 / 8 | 240 / 80 | 2,400 / 800 |
| Actuals / DayNotes / Todos / Materials | 12 / 4 / 3 / 4 | 120 / 40 / 30 / 40 | 1,200 / 400 / 300 / 400 |
| Subject / templates / terms / periods | 1 / 3 / 1 / 3 | 1 / 3 / 1 / 3 | 1 / 3 / 1 / 3 |

Every arrow below is **baseline → candidate**, using the same operation sequence. "Cold" here resets the synthetic planner client/migration gate, not browser assets or a real SDK disk cache.

| Operation | Logical read calls, all sizes | Small returned docs | Medium returned docs | Large returned docs |
| --- | ---: | ---: | ---: | ---: |
| Cold planner launch | 11 → 10 | 96 → 64 | 879 → 559 | 8,709 → 5,509 |
| Warm planner launch | 10 → 9 | 95 → 63 | 878 → 558 | 8,708 → 5,508 |
| Day / next day / week / next week / month / next month, each | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| One manual save | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| One-item approval plus completion | 20 → 10 | 106 → 7 | 889 → 7 | 8,719 → 7 |
| Five-item approval plus completion | 88 → 38 | 552 → 27 | 4,467 → 27 | 43,617 → 27 |
| Explicit full refresh after saves | 10 → 9 | 109 → 70 | 892 → 565 | 8,722 → 5,515 |
| Cold planner reload after saves | 11 → 10 | 110 → 71 | 893 → 566 | 8,723 → 5,516 |

The one-item approval still has three missing-document calls and the five-item approval eleven, unchanged on both revisions. Those calls are included in logical calls but not in returned-document totals; neither metric is a billing estimate. Navigation/manual-save zero means no read at this measured boundary, not zero writes or zero whole-app activity.

Reproduce with `node scripts/performance/measure-firestore-read-load.mjs 22847120386987329e2f034d6062d59694ef1180 /tmp/firestore-read-load-final`. The final baseline source fingerprint is `ce78460aa34b736884d488189052f792c9340f61daba6574cf88ce570437602b`; the measured candidate fingerprint is `307af50dbe14ce7e819447f48f3ae93f8e13f5decbac662d8c9c3bd6a3398a97`. [Durable evidence and definitions](evidence/20261008-firestore-read-load/README.md), [all 39 comparisons](evidence/20261008-firestore-read-load/comparison.json) and [source/toolchain provenance](evidence/20261008-firestore-read-load/provenance.json) accompany this record.

This final reproduction includes the fixture's guaranteed global-mock cleanup and later integration source changes. Both sides again pass five tests, all 39 phases and all three final persistence comparisons agree, and all counts are unchanged. An independent audit verifies **1,414 baseline inputs and 1,419 candidate inputs**, all source/manifest/result hashes and the final logs with no mismatch. `provenance.currentRunLogs` contains the final run's complete logs; the separate `before.log` / `after.log` files are explicitly earlier-run evidence. Later source changes still require checking the affected inputs rather than relying on HEAD alone.

### Isolated Emulator observations

For the same completed-migration schedule fixture sizes, actual SDK/gRPC observations are:

| Schedule consumer | Canonical Listen targets | Canonical document responses, small / medium / large |
| --- | ---: | ---: |
| Existing two concurrent getters | 1 | 32 / 320 / 3,200 |
| New combined getter | 1 | 32 / 320 / 3,200 |
| Two existing getters invoked sequentially | 2 | 64 / 640 / 6,400 |

Each cold completed-marker path also observes one marker target and one marker document response. The concurrent result disproves the inference that two `getDocs` calls necessarily cause twice the server traffic. The sequential control demonstrates when combining an explicit read can avoid a duplicate transport target; it is not the measured current full-startup call ordering.

The migration control with 32 events observes one legacy Plan target / 24 documents, one legacy MonthEvent target / eight documents, three canonical targets / 64 document responses, one missing-marker target / zero responses, and two transaction-document requests (one existing lease response and one missing initial marker response). A completed reload has one canonical target / 32 responses and one marker target / one response, with no legacy query or transaction. Snapshot equivalence, denied cross-owner reads/writes and denied post-cutover legacy writes all pass.

These are transport observations, not billable operations. Rules-dependent reads, billing minimums, browser WebChannel behavior, multiple tabs/reconnection and production usage remain unmeasured. The planner read fixture also does not measure trace append/retry, admin lists/exports or Worker background load. Failure/recovery/account-isolation coverage from focused tests is separate from the successful-path read totals above.

[Emulator report](evidence/20261008-firestore-read-load/emulator-report.json) records input/source/Rules/bundle SHA-256 values. Toolchain: Firebase 12.12.0, Node 24.19.0, Java 21.0.12.1, Firestore Emulator 1.20.2. Reproduce with `node scripts/performance/firestore-read-load-emulator.mjs /absolute/path/cloud-firestore-emulator-v1.20.2.jar`; the official artifact's SHA-256 is `4a117fc297b1441eac1b7756e80442e86ef88865b9e3caf6f59eabf83da574f8`.

The final standard Emulator run passes **11 scenarios**, exit 0. The dedicated strict TypeScript check, runner syntax and whitespace checks also pass; all 33 non-stub source hashes in the candidate replay report match the then-current worktree. These checks do not change the independently recorded first-save exit 2.

The test-only runner verifies the literal demo project and loopback address, uses a clean child environment/HOME, does not load `.env`, the Firebase CLI or the app's production Firebase client, and rejects gRPC and fetch connections outside its owned Emulator. Negative non-loopback endpoint guard tests pass without making those connections.

The additional real-app/data-hook and real-approval-repository comparison uses current Rules. Its cold startup has **nine query targets plus one marker target, 64 document responses in the small fixture**, unchanged before/after, with matching loaded-state/projection digests. The approval transaction then gets `PERMISSION_DENIED` on item 1 of 5 for **both** baseline and candidate. The operation read rule calls `canReadOwnedResource`, which accesses `resource.data.userId` even when the operation document does not yet exist. The transaction must read that missing document before its first create. This is a reproduced existing contract blocker, not evidence of a regression from read reduction or proof of the production incident's cause.

Zero approval items were saved in those first-creation real-Rules runs. Do not compare their failed operation totals with the successful mock or call fewer responses on a denied run an optimization. Successful first-creation wire-read reduction remains unmeasured until the blocker is resolved and the same successful scenario is rerun. Keep any Rules change and its authorization/deployment verification distinct from the client-side measurement.

The [baseline first-save report](evidence/20261008-firestore-read-load/emulator-approval-new-before.json) and [candidate first-save report](evidence/20261008-firestore-read-load/emulator-approval-new-after.json) both return **exit 2**, explicitly classifying the blocked scenario rather than reporting green. Reproduce through the Emulator runner's `--approval-before` / `--approval-after` flags.

These first-save reports identify an earlier isolated harness snapshot, before subsequent replay/accounting additions. The two reports used matching harness inputs and the unchanged Rules; they remain evidence of that denial, not proof that the final current harness was rerun for first creation. Their recorded input hashes must not be relabeled as current hashes.

[Issue #51's existing approval work](https://github.com/kame447/StudyPlanner/issues/51#issuecomment-6058507615) now owns this defect separately from Issue #542; no duplicate Issue was created. The additional isolated Rules repair/verification was subsequently approved separately and remains owned by Issue #51. This read-load branch does not change Rules or authorize production deployment.

### Successful real-Rules replay, a separate scenario

An ordinary authenticated owner replays an already-completed five-item approval operation, starting with its five plans already present in addition to each base fixture. The real app/data hooks and approval repository run against the same unchanged Rules. Before/after runs pass for all three sizes, exit 0. All nine phase comparisons preserve application data and projections, and all three final application states and persisted approval-plan digests agree.

| Replay phase metric | Before | After |
| --- | ---: | ---: |
| Full-collection query targets, each size | 45 | 0 |
| Listen document responses, small | 346 | 6 |
| Listen document responses, medium | 2,821 | 6 |
| Listen document responses, large | 27,571 | 6 |
| Transaction document requests / found responses, each size | 32 / 32 | 32 / 32 |
| Actual ledger writes, each size | 16 | 16 |
| Plan / migration writes, each size | 0 / 0 | 0 / 0 |
| Commit requests / verify preconditions, each size | 6 / 16 | 6 / 16 |

The six remaining Listen responses are marker-document responses, not full planner reloads. The 16 writes comprise six operation and ten item-ledger writes; verify preconditions inside a commit are not counted as document writes. The replay cold start stays at nine query targets plus one marker target and **69 / 564 / 5,514** document responses on both revisions. Its final explicit refresh is also unchanged at **68 / 563 / 5,513** responses. This is evidence for removing repeated reloads, not for making startup or an explicit refresh constant-size.

[Replay comparison](evidence/20261008-firestore-read-load/emulator-approval-replay-comparison.json), [baseline report](evidence/20261008-firestore-read-load/emulator-approval-replay-before.json) and [candidate report](evidence/20261008-firestore-read-load/emulator-approval-replay-after.json) retain the source/transport evidence. Reproduce with `--approval-replay-before` / `--approval-replay-after` on the same Emulator runner/JAR. The passing replay does not remove the separate first-save denial or establish production billing totals.

Record returned documents separately from query calls. Do not add repository and SDK observations of the same read twice. Listener snapshot sizes, metadata-only events, cache delivery and changed documents are distinct metrics. Repeated runs must retain every value and failure, not just a fastest sample.

## 100 / 1,000 / 10,000 DAU comparison

DAU means daily active users, not registered accounts or concurrent users. The operation-level numbers above are measured in the mock; this daily frequency and population multiplication is an explicit **assumption**, not an observed usage pattern:

`daily logical returned documents = DAU × per-user scenario documents + explicitly modeled shared work`

Assume every active user performs the full 13-phase sequence once a day: one cold planner launch, one warm planner launch, six navigation actions, one manual save, one single-item approval plus completion, one five-item approval plus completion, one full refresh and one cold reload. Each daily fixture starts with the stated cardinalities. This is a fixed-data sensitivity scenario, not a multi-day growth simulation. Shared work is excluded, not measured as zero.

Per daily sequence, logical read calls are **150 → 86** and missing-document calls stay **14 → 14**. Returned fixture documents are **1,068 → 302** (small), **8,898 → 2,282** (medium), and **87,198 → 22,082** (large), reductions of 71.72%, 74.35% and 74.68% in that metric.

| Daily active users | Small docs/day, before → after | Medium docs/day, before → after | Large docs/day, before → after |
| --- | ---: | ---: | ---: |
| 100 | 106,800 → 30,200 | 889,800 → 228,200 | 8,719,800 → 2,208,200 |
| 1,000 | 1,068,000 → 302,000 | 8,898,000 → 2,282,000 | 87,198,000 → 22,082,000 |
| 10,000 | 10,680,000 → 3,020,000 | 88,980,000 → 22,820,000 | 871,980,000 → 220,820,000 |

Linear arithmetic is not a concurrency/load-capacity test. The Emulator's concurrent-query deduplication shows concretely why these logical returned-document totals must not be converted directly into a Firestore bill or free-quota guarantee. Actual account size, device/cache behavior, operation frequency, background work, region, edition and billing terms need separate evidence.

### Separate replay-based price sensitivity

This model uses the **real-Rules cold start plus replay/completion of five already-saved plans**, once per DAU per day for 30 days. It does not price the 13-phase mock sequence, does not include the final test-only explicit refresh, and does not assume a successful first save. The per-session model treats each observed Listen/transaction document response as one read equivalent: **447 → 107** (small), **3,417 → 602** (medium), **33,117 → 5,552** (large). Actual observed document writes are **16 on both revisions**; the 16 verify preconditions are not added as writes.

Assume Firestore Standard, Iowa (`us-central1`), USD on-demand pricing and an eligible database receiving the entire daily free allowance. [Official pricing](https://cloud.google.com/firestore/pricing) and [quotas](https://firebase.google.com/docs/firestore/quotas) were checked on 2026-10-08: $0.03 / 100,000 reads, $0.09 / 100,000 writes; 50,000 reads and 20,000 writes free per day. Actual production region, edition and eligibility were not inspected. Apply each day's allowance before summing the 30 days.

| DAU | Small partial USD/month, before → after | Medium partial USD/month, before → after | Large partial USD/month, before → after |
| --- | ---: | ---: | ---: |
| 100 | 0.0000 → 0.0000 | 2.6253 → 0.0918 | 29.3553 → 4.5468 |
| 1,000 | 3.5730 → 0.5130 | 30.3030 → 4.9680 | 297.6030 → 49.5180 |
| 10,000 | 43.5600 → 12.9600 | 310.8600 → 57.5100 | 2,983.8600 → 503.0100 |

These are **conditional partial read/write costs, not measured bills or total-cost upper bounds**. In particular, the calculation allocates all free quota to this one modeled activity; shared/background usage is unknown rather than known to be zero. The [full assumptions, daily formula, cost breakdown and conditional quota sensitivity](evidence/20261008-firestore-read-load/cost-model.md), [machine-readable values](evidence/20261008-firestore-read-load/cost-model.json) and [recalculation script](evidence/20261008-firestore-read-load/calculate-replay-costs.py) preserve the distinction. Independent recalculation matches all nine price cases and all six conditional quota boundaries, with the source report hashes verified.

### Remaining growth and cost constraints

This change primarily removes repeated full reloads after a batch save. **Startup still reads the user's full stored history.** The concurrent startup transport measurement is one canonical target before and after, so neither history growth nor a larger user population becomes free or constant-cost because of the combined snapshot. The 10,000-DAU row is not an accepted capacity limit or proof that a free tier is sufficient.

Bounding full-history growth still needs a separate design under [Issue #164](https://github.com/kame447/StudyPlanner/issues/164) and its client-first requirements: distinguish current-view projection, historical reports and AI/context inputs; define range or staged acquisition plus synchronization/reconciliation. A simple date lower bound or document limit would lose old recurring series, spanning events, history-dependent reports or required AI context. Preserve those consumers and account boundaries before adopting a narrower read contract.

The design audit rechecked Issue #164 as open on 2026-10-08; it already owns local replica/cache/ADR work, so a duplicate cache issue is unnecessary. Before implementing staged reads, its contract must distinguish requested purpose/range from completed coverage, next cursor/exhaustion and cache/server freshness, in addition to the existing owner/reset epoch and accepted revision. Partial, unrequested or stale data must not become a ready empty array. Preserve Issue #437's all-or-none requested-group publication, crossing-writer re-read and captured consumer lease through asynchronous AI module/OCR work.

Concrete consumers prevent a simple limit: the occurrence projector looks back for previous-day overnight Plans and across the full span of multi-day events; recurrence needs old anchors/rules/excluded dates. Lifetime reports, occurrence deduplication and pace estimates use historical Actuals and referenced Plans. Any Actual pagination needs its referenced-Plan closure; calendar queries must deliver complete candidates to the existing occurrence projector. These are remaining acceptance constraints, not an implemented paginated/local-replica feature.

A narrower candidate was to filter a **single-projection repair** by owner and `provenance.legacy.kind` instead of fetching all canonical schedule documents before that same filter. Event `kind` (for example study/general) is not an equivalent substitute because it would omit legitimate Plan categories. A controlled compatibility probe found **10 failure divergences**: five missing/null/empty provenance or legacy shapes across the two getters currently reject, but the filtered query silently excludes them and succeeds. Valid fixture rows and owner/retry cases were equivalent, but no complete record-validation/coverage guarantee exists. The candidate was rejected without a repository runtime change; its hypothetical read counts are not included in any improvement result. It would not solve full-startup history growth even if later validated.

The scenario excludes shared backend/cron work, trace append/retry, admin history/export, authentication/profile and catalog/other metadata reads, telemetry, Rules-dependent reads, index entries, contention retries and unmodeled reconnects. No actual production price, quota headroom or total-cost ceiling is established. Even a future region/edition-specific monetary sensitivity table for the measured operations would be a partial scenario estimate, not a total billing upper bound while those terms remain unknown.

## Browser and integration verification boundary

[Browser capability evidence](evidence/20261008-firestore-read-load/browser-probe.json) records Chromium 154.0.8037.57 and Playwright 1.62.1 failing to launch because the execution environment rejects the process-singleton socket with `EPERM`. The normal attempt and an isolated-home attempt both fail before reaching the application. This is neither an app test failure nor a browser pass. No desktop/mobile image was captured.

Planner reconciliation, startup gates, approval races, timetable startup and the consent-timeout/retry browser UI were therefore **not executed**. No alternative user device, remote CI or deployment was used to bypass this limitation. The isolated build probe also stopped in the existing Vite network-interface helper before compilation; it does not establish that the application build fails. The final integration build/verification result must be recorded separately.

The first combined `npm run verify` stopped in the app typecheck with `TS2322` in the new native-approval audit's spy annotations (lines 46 / 64). This was a corrected test-harness typing defect, not a successful full run. Worker checks, the full test suite and production build had not run at that point.

A subsequent integration run passed fresh app/Worker typechecks but stopped at the full unit suite: **3 failed / 762 passed / 10 skipped files**, **19 failed / 6,185 passed / 45 skipped / 1 todo tests**, exit 1. The three failing component-recovery suites still mocked the old repository contract without `getScheduleSnapshot`. Their fixtures were adapted without weakening readiness assertions, and the final full rerun below passes. The failed attempt did not reach the production build and is not counted as a successful verification.

### Final exact-content local pass

`npm run verify` ran from **2026-10-08 11:17:31 to 11:27:59 UTC**, exit 0, on the dirty `perf/firestore-read-load` candidate at committed HEAD `22847120386987329e2f034d6062d59694ef1180`:

- Fresh non-incremental app and Worker typechecks pass, including regenerated Worker types.
- **765 passed / 10 skipped files**; **6,204 passed / 45 skipped / 1 todo tests**. Full test duration: 573.03 seconds. Skipped/todo cases remain unexecuted, not additional successes.
- Production build passes in 11.47 seconds. Existing nonfatal mixed static/dynamic import and large-chunk warnings remain.
- `node scripts/ci/check-bundle-budget.mjs` passes all eight unchanged budgets. JS total raw/gzip **2,244,218 / 603,513 bytes**, largest **763,296 / 215,434**; CSS total **484,128 / 81,302**, largest **423,600 / 68,637**.
- All **1,855 included input hashes** match before/after: manifest SHA-256 `88cf2c71cd43fcc760977a404f72dbbe70e97ab4cf78d1a7ccb5bfc2f552803e`. All **336 actually installed package entries** match before/after: manifest SHA-256 `33f6896aab782ec816c5d3afa66c7f15c5d040354650ba8534b8f00053570ecd`. No missing nonoptional package or installed-version mismatch.
- Node 24.19.0, npm 11.9.0, TypeScript 5.9.3, Vitest 3.2.7, Firebase 12.12.0, Vite 6.4.3, Wrangler 4.143.1, React 18.3.1. The generated Worker-type bytes remain SHA-256 `bf808b3fb4789a76410fc9c1ba8cd85e80453b8f92fa0981bdb86a9d523d612e` before/after.
- The run uses an isolated environment without inherited credentials, live API opt-ins or production environment files. Documentation and the explicitly standalone non-test Emulator runner are excluded from this full-run input scope; the normal mock measurement test is included. The Emulator/security/browser gates remain separately identified.

[Final summary](evidence/20261008-firestore-read-load/full-verification/summary.json), [terminal log](evidence/20261008-firestore-read-load/full-verification/verify.log), [exact scope](evidence/20261008-firestore-read-load/full-verification/scope.txt), [input manifest](evidence/20261008-firestore-read-load/full-verification/inputs.json) and [installed-package manifest](evidence/20261008-firestore-read-load/full-verification/installed-packages.json) preserve this evidence. Later runtime/test/configuration changes invalidate the corresponding proof; documentation-only updates do not establish a new runtime snapshot.

### Pending-branch compatibility, not an integration pass

A read-only audit on 2026-10-08 checked the pending UI branches without merging or modifying them:

- [PR #540](https://github.com/kame447/StudyPlanner/pull/540) overlaps the reconciliation browser spec. Preserve its Home-button naming change and this work's nine-getter/combined-snapshot expectation. Its new tests inherit the API through real repository factories rather than missing hand-written mocks.
- [PR #541](https://github.com/kame447/StudyPlanner/pull/541) additionally overlaps the app/data hooks and client-runtime index. Preserve both `projectPlanSave` and the Day work's source-write protection / `deleteDayOccurrence` boundary. Approval acknowledgement versus same-day cancellation/Undo, both orderings, lost acknowledgement plus failed/read-only retry, owner A→B→A and Plan/MonthEvent union repair require new combined verification; this branch's isolated checks do not establish those interactions.
- Neither UI branch changes the root-shell readiness wiring. Recheck startup/deadline/parallel readiness and an ordinary Home start after actual integration. PR #541's existing [WebKit matrix failure](https://github.com/kame447/StudyPlanner/actions/runs/37750627863) was a Day 1280px timeout on its own head, not a measured regression from this unpublished change.
- Issue #488 remains untouched. The receipt-to-projection boundary is a potential future integration point, but its implementation was not available for this audit. No compatibility guarantee or transfer of semantic/approval/ledger authority is made.

A later isolated three-way candidate combined Day commit `250bf511b2a3960b376a367b80ef59dc79b98e0d` with the frozen Issue #542 working sources, preserving all four conflicting data-hook capabilities. It passed **57 tests in three files**: 17 new cross-feature cases, 25 existing Day cancellation cases and 15 approval-projection cases. The new cases cover both start/acknowledgement orders of cancellation and Undo, Plan/MonthEvent/template lost acknowledgements with failed repair and read-only retry, union repair and owner A→B→A. No product-code correction was needed after constructing that isolated candidate.

[Source/parity manifest](evidence/20261008-firestore-read-load/cross-projection-manifest.json) and [terminal test log](evidence/20261008-firestore-read-load/cross-projection-tests.log) preserve the result. This used real app/data hooks and the local storage repository, not Firebase transactions. It did not modify or merge either active branch. Before real integration, retain both sides of the callback conflict, port the cross-feature regressions to the combined branch and rerun type/full/build/browser/Firestore gates on that exact content; this isolated focused result is not that integration pass.

## Exit criteria and remaining work

- [x] Comparable baseline/current mock measurements with fixture and operation definitions; all 39 successful-path comparisons are equivalent.
- [x] Local Emulator isolation checked before requests; schedule/migration transport observations recorded separately.
- [x] Track the real-Rules initial-approval blocker separately in existing Issue #51; preserve its exit-2 evidence and keep successful replay evidence distinct. Further isolated Rules repair is separately authorized under Issue #51; production deployment remains excluded.
- [x] Approval projection and combined snapshot preserve the tested freshness, owner-isolation, failure-recovery and idempotent-replay guarantees; first creation under Rules remains the separate blocked scenario.
- [x] Startup investigation yields evidence-backed bounded-failure/visible-retry fixes and safe local verification; real-device latency and faster successful startup remain unverified.
- [x] Combined exact-content `npm run verify`, applicable local boundary tests, production build and bundle budgets pass after classified fixture corrections.
- [x] Exact content identity, actual installed toolchain, documentation links and missing verification are recorded at this checkpoint.
- [x] Measured improvement, modeled scale and unmeasured production effects are separated. PR publication and automatic preview are separately approved; main integration and production rollout remain excluded.
- [ ] Exact-HEAD remote CI/browser gates and automatic Cloudflare preview remain to be verified after publication. Local browser/visual and actual-device acceptance remain unavailable in this environment; local/full and isolated branch probes do not replace them.

When this work is completed, move its execution history to `docs/archive/work/closed/` after transferring any durable invariant to its existing canonical owner. Do not leave completed status in an active work record or duplicate the canonical recovery contract here.
