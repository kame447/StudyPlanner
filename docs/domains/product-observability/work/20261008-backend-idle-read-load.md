# Scheduled maintenance idle read load

Status: integrating main c3113a49 after client PR #546; combined focused/type/build checks passed; final CI then authorized main/Pages rollout pending; manual scheduled-Worker deployment is separate and pending

- Owning investigation: [Issue #542](https://github.com/kame447/StudyPlanner/issues/542); product-observability contracts remain owned by [Issue #213](https://github.com/kame447/StudyPlanner/issues/213).
- Active branch: `perf/firestore-backend-idle-reads`; exact base: `22847120386987329e2f034d6062d59694ef1180`.
- Preflight on 2026-10-08: current remote main verified; all open PRs and all 33 remote branches inspected. No active snapshot/retention read-load implementation found. Existing PR #312 is merged and Issue #308's HTTP subrequest budget is retained.
- This is a separate backend release unit from published client-runtime PR #546. Its branch and working files are not modified. On 2026-10-08 the user approved publishing this implementation as an additional draft PR and its automatic Cloudflare preview. Main mutation/merge, production deployment, real Firestore/AI, credential and billing changes remain outside scope. Reuse Issue #542; do not create another Issue.
- Current scope: reduce clean idle snapshot and unexpired-retention reads without changing official counts, dirty revision clearing, transaction consistency, scan resumption, expiry decisions, day boundaries or the 45-subrequest application budget. Both local changes passed independent type/concurrency review and final combined local verification.
- Measured baseline: each clean snapshot invocation reads one rollup checkpoint plus job, current snapshot and all 64 accumulator keys: 67 keys even when no scan is needed. The 3 HTTP requests do not mean 3 document reads. Offline measurements distinguish returned documents, missing keys, empty queries and hypothetical billing equivalents.
- Candidate: when no dirty source was supplied, check only the job and today's snapshot for a clean idle return. Otherwise retain the original complete read set and transactional compare before changing any state. Do not cache cross-invocation state.
- Publication preflight at 2026-10-08 13:43 UTC rechecked all 33 remote branches, all 12 open PRs, related closed PRs, Issue #542 and its comments. Current main remains the exact base above. No overlapping backend idle-read PR or remote branch exists. The coherent backend implementation needs its own reviewable PR because client PR #546 owns a separate runtime boundary.
- Initial publication: [Draft PR #547](https://github.com/kame447/StudyPlanner/pull/547), remote head `8a9556e7373bab78d53b11a2d6cbd3a749e4d34e`, matching local `0e705061a33f26a03fabb5ded7f3b787c9995639` tree `743944f57be1824c7f243231008cd4bb9bd2bed6`. The single parent is the exact base above.
- The browser harness repair was published on the same branch at `05906f69687ef3bacc5265e30869e0a7584dba72`; all five workflows and Pages succeeded at that published head (see [final Issue checkpoint](https://github.com/kame447/StudyPlanner/issues/542#issuecomment-6062029032)). Those checks used the original main base and do not certify the newer integration candidate below.
- Current authorized workflow (2026-10-09): PR #546 merged first, then integrate its main `c3113a49e94e08ea4a3be5a75e1c962f34ac1aab` into existing PR #547, verify combined source and exact-head CI, and proceed with approved normal main merge/automatic Pages publication. The scheduled Worker requires a separate manual deployment/authentication step, not covered by the automatic Pages result. No credential, billing or manual production-data change is authorized. Preserve all protected AI planning/E2E and unrelated work.
- Exit criteria: idle 67 to 3 keys verified at the scheduled boundary; same canonical results and retry/ownership guarantees under dirty addition, day rollover, resumed work and conflicting reads; all scheduled paths remain within 45 HTTP subrequests; exact source/toolchain evidence and current documentation; full local verification before calling implementation ready. Production effectiveness and billing remain unverified.

## Implemented local candidate

The snapshot fast path is limited to a supplied empty dirty list. It validates the job and today's snapshot before returning idle. Any ambiguous/pending state falls through to the original full 66-key read; the exact full read remains the compare target inside the publish/checkpoint transaction. No cross-invocation cache, dirty-clear changes, index, IAM/Rules or metric schema changes are made.

Retention now uses the existing ordered query with limit 1 only as an idle gate. A positive gate always triggers a fresh full page, and only the unchanged prefix predicate over that full page selects deletes. The same allowlist, cutoff captured once, batch clamps, commit boundary and delete-driven progression remain. A concurrent arrival after a negative probe can wait until the next invocation; it is not silently marked processed. The original full-read-to-commit refresh race and lexical timestamp edge are not repaired by this change.

## Observed counts versus modeled cost

[All evidence, definitions and reproduction](evidence/20261008-backend-idle-read-load/README.md) separate returned documents, missing keys, empty queries, HTTP requests and conditional read equivalents.

| Scenario, one invocation | Before | Candidate |
| --- | ---: | ---: |
| Clean snapshot document keys, including rollup checkpoint | 67 (3 found, 64 missing) | 3 (3 found) |
| Clean snapshot HTTP | 3 | 3 |
| No-dirty empty day bootstrap HTTP / point keys | 36 / 133 | 37 / 135 |
| Dirty maximum publish/clear HTTP | 44 | 44 |
| Retention, 100 unexpired rows in each of four collections, returned documents | 400 | 4 |
| Same retained fixture HTTP / deletes | 5 / 0 | 5 / 0 |
| Retention, two full expired batches, returned documents / HTTP | 800 / 11 | 808 / 19 |
| Retention deletion throughput, each batch / two batches | 400 / 800 | 400 / 800 |
| Empty rollup point keys / empty queries / HTTP | 2 / 1 / 6 | unchanged |
| Both backfills complete: point keys / HTTP | 2 / 3 | unchanged |
| No-op reads and HTTP | 0 | 0 |

Each phase runs 288 times/day if the every-minute cron runs continuously. In a deliberately steady retained-data scenario, backend returned documents are 117,216→3,168/day; empty-query minima add 288 on both sides. The baseline additionally requests 18,432 missing keys/day. Assigning one equivalent per missing key yields **135,936→3,456 conditional read equivalents/day**. Without that missing-key billing assumption, the comparison is **117,504→3,456**. These are not observed bills or whole-app totals. Retention alone supplies the original 115,200 returned documents/day from the same 400 retained records; no new user activity is needed in that scenario. Empty rollup checkpoint writes remain 288/day. Explicit verify writes are zero in the measured backend cases.

The all-empty-query steady model is 21,888→3,456 equivalents/day under the same missing-key assumption. Both models exclude daily snapshot rollover, actual event/actor growth, dirty rebuilds, conflict retries, unfinished migrations, index-entry/aggregation charges, client reads and trace/admin work. A single empty day-bootstrap run replacing one baseline idle run adds 96 modeled equivalents; populated 30-day scans can be much larger.

Data-dependent observations include 100 distinct-actor planning events in five rollup batches causing 320 point keys plus 100 event documents (31 HTTP), versus 35 point keys plus the same 100 events when all events share an actor/session in this synthetic missing-projection fixture. Two late conflicts reread 140 events and 448 keys at 45 HTTP. A dirty snapshot with 100 actor-day rows on each of 30 dates reads 3,000 actor-day documents plus 134 point keys. With 500 rows/date, the 35-page cap is reached after 9,000 returned rows and 17 empty page tails, and the job checkpoints rather than publishing partial counts. These paths are unchanged by the idle fast path.

The combined backfill phase includes both profile registration and user enrichment. A 250-profile/17-user backlog processes 200 profiles and 17 summaries in one invocation: 217 query documents, 3 point keys, 17 empty recent-error queries and 17 COUNT aggregations, 44 HTTP. COUNT's scanned index entries were not measured. Completion avoids repeated profile scans but still reads both checkpoint documents on every backfill phase.

## Verification checkpoint

- Snapshot baseline: 4 expected failing regressions / 12 passing cases. Candidate: all 16 pass, including dirty/bootstrap 18,001-actor resumption and exact official counts.
- Retention baseline: 9 expected failing regressions / 5 passing cases. Candidate: all 14 pass, including positive/negative gate races, malformed head, exact cutoff and failed commit retryability.
- Combined focused check: 6 files / 56 tests passed. Existing 45-request hard stop and dirty-revision preservation tests remain unchanged.
- All 32 scheduled mock scenarios have identical successful write/delete payload SHA-256 values and mock work-progress state before/after. The result is available in [comparison.json](evidence/20261008-backend-idle-read-load/comparison.json).
- Independent snapshot review: four additional race/resume cases passed, no blocking finding.
- Independent retention review: 33 baseline/candidate comparisons (11 fixtures × page sizes 1/2/100), four positive-gate races and three injected failure paths passed; no blocking finding.
- Final fresh `npm run verify` ran 2026-10-08 12:45:25–13:02:51 UTC, **exit 0**: fresh app/Worker types, **759 files passed / 10 skipped**, **6,163 tests passed / 45 skipped / 1 todo**, and production build **10.42s**. Skipped/todo cases are not counted as passed. All eight unchanged bundle budgets passed at 13:02:52 UTC.
- The 1,845 runtime/test/configuration input entries and installed-package identities are identical before/after: 237 actual installed packages and 99 platform-optional absent lock entries; no missing required package or version mismatch. [Summary](evidence/20261008-backend-idle-read-load/full-verification/summary.json), [terminal log](evidence/20261008-backend-idle-read-load/full-verification/verify.log), [scope](evidence/20261008-backend-idle-read-load/full-verification/scope.txt), [inputs](evidence/20261008-backend-idle-read-load/full-verification/inputs.json) and [actual packages](evidence/20261008-backend-idle-read-load/full-verification/installed-packages.json) retain exact-content proof.
- One worker and isolated environment were used. Type/build outputs are per-worktree; the inherited shared Vitest result-order cache is disclosed in [environment notes](evidence/20261008-backend-idle-read-load/environment-notes.md). Installed Vitest code confirms this cache affects ordering/duration history, not whether tests execute. No in-progress environment change or dependency installation occurred.
- Before initial publication, no runtime/test/configuration input changed after full verification. Publication preflight independently rechecked all 1,845 input hashes and actual package identities: zero mismatches, 237 present and 99 platform-optional absent. Documentation-only publication-checkpoint updates do not constitute a second verification run. The exact local implementation commit is `119f52ad2fa6aa15ccc7cc3957e8f219a29b3441`; any later local change before publication is documentation-only. No new Issue or branch deletion is needed. The backend branch is retained for review; PR #546's client implementation remains separate. Live Firestore behavior, production effectiveness and billing are still unverified.

## Initial publication and browser harness repair

Initial exact head `8a9556e7` and synthetic merge `255779359a9be119a18fe6bac87e9c6bb60845ae` share tree `743944f57be1824c7f243231008cd4bb9bd2bed6`. [CI](https://github.com/kame447/StudyPlanner/actions/runs/37792192198) passed fresh types, dependency audit, 6,163 tests (45 skipped / 1 todo), Firestore Rules and production build. [Admin Overview](https://github.com/kame447/StudyPlanner/actions/runs/37792192100) passed 45 tests. [Pages preview](https://1332a29d.studyplannner.pages.dev) succeeded for that exact head. UI Matrix/Quality path filters did not select this backend/docs-only change; they were not run and are not counted as passed.

[Browser Regression](https://github.com/kame447/StudyPlanner/actions/runs/37792192193) finished with 433 passed and 1 flaky, so the strict gate failed. The pre-existing month-event storage-recovery test failed its edited-save error assertion on the first attempt and passed retry 1. Artifact `11557407656` (SHA-256 `3a29d9d74ec9ffdc8fb05692b8b27f494fe8372e2f2eb2cf3ffa0403c7818924`) shows the second editor opening about 86 ms before the save click, while the 300 ms panel and delayed 240 ms control entrance were still moving. The click used y=145; the final save position was y=41. Actual images retain the edited input and original saved event, with no save error displayed. At that checkpoint a timing race was supported by the trace and the repaired browser result was still pending. The subsequent published-head Browser Regression passed all 434 cases with no flaky result, including this scenario on its first attempt; see the final Issue checkpoint above.

The narrow test-only candidate waits for the two editors’ actual finite entrance animations to finish before fault injection/click, and explicitly verifies that each injected storage failure was consumed. It changes no runtime/UI, assertion expectation, timeout, retry policy, animation or failure outcome. There is no arbitrary sleep. `node --check`, `git diff --check`, Playwright 1.62.1 collection of all 7 cases in the changed spec, and all 7 `MonthEventDialog.persistence` unit cases passed. The existing isolated Playwright installation was reused read-only; no dependency was installed or modified. An initial unit invocation stopped at configuration startup because the sandbox required an explicit loopback development host; that invocation did not execute tests and is not counted as a pass. Browser execution of the repair is not yet verified locally.

The initial full local evidence above certifies the backend implementation before this E2E-only edit. Following the authorized focused-local → draft update → final-CI sequence, another local full run is not claimed. That updated-head CI subsequently succeeded; it remains separate from verification of the newer current-main integration candidate.

## Current-main local integration preparation — 2026-10-08 21:25 UTC

Current remote main is `f281c6c0ba56ef7b57865b7edcfd276d11a7b2ab`, which adds the already-merged PR #545 startup video to the original base. Existing PR #547 remains at `05906f69687ef3bacc5265e30869e0a7584dba72`. The two diffs modify 32 and 36 disjoint paths; AGENTS, dependencies and runner configuration are unchanged. A local synthetic merge produces tree `a77942747de125c23154ed57179b0b7c30b5ed4d` without conflicts. Every main-added file and every PR file is preserved byte-for-byte.

The verification-only detached candidate is `c14b967b9dc4501776e1ba2df7113bcf20baf562`; no new branch or PR was created, and the published backend branch was not moved. The PR #548 video-fix worktree, AI planning code/dedicated E2E and Orrery are untouched. Only this candidate’s documentation is updated after the checked source snapshot.

- Focused integration: 144 passed across 11 files (backend 56, startup 81, month-event persistence 7), plus 22 media-response cases; all exit 0. No cache or prior pass result was reused.
- Fresh app/Worker typechecks and generated Worker runtime types: exit 0. Production build: exit 0, 7.14 seconds. All eight unchanged bundle guards passed.
- All 1,854 tracked non-documentation input hashes were unchanged before/after. Actual installed identities: 237 present /99 platform-optional absent, zero mismatch. No dependency installation occurred.
- One media test command initially used the wrong Node runner and stopped before assertions. Inspection showed the spec imports Vitest; the correct repository runner then passed all 22 cases. The initial command error remains recorded rather than counted as a passing test.
- This is focused integration preparation. The full unit suite, browser/visual/remote CI on this exact combined tree, and live Firestore/billing remain unverified. Historical green checks for PR #547 do not replace those integration gates. No push, main merge, deployment, production-data or billing action was taken.

[Integration summary and command evidence](evidence/20261008-backend-idle-read-load/current-main-integration/summary.json)

## Current-main publication update — 2026-10-08 22:58 UTC

Main advanced to `fc708da391037589a0cd15c872563d2e086e3e5e`, including PR #548's startup-video completion/ready-only skip behavior. The earlier detached candidate `0782c33f` was preserved and merged locally with that main snapshot. Candidate `0993d3d94641fa97dd8e55c8b999a57fd0b77f71`, tree `5de3462297c878a3d76cedfa17e48d946cf8081f`, has no conflict. All 63 main-changed paths since the original base and every published backend runtime/test blob are retained exactly. There is no additional AI planning code/dedicated E2E, dependency, runner, workflow, Rules or index edit relative to current main.

- Focused combined checks: 197 passed across 14 files, exit 0, with result caching disabled. They cover backend idle/dirty/budget boundaries, startup and readiness behavior, planner-data recovery, month-event persistence and media responses.
- Fresh app/Worker typechecks with regenerated Worker runtime types, build (13.18 seconds), and all eight unchanged bundle guards passed.
- Playwright 1.62.1 collected 23 cases across the month-event and startup-video specs. Collection is not browser execution.
- The 1,857 tracked non-documentation input hashes and 237 actual installed package identities/99 optional absences match before and after. No dependency was installed or modified.
- Independent review found no source-level blocker and reran four snapshot race/resume cases, 33 retention equivalence cases, four positive-gate races and three injected failure cases against actual current-main code. Real network access was intercepted.
- Follow the authorized focused-local → existing draft update → exact-head final CI workflow. A repeat local full suite is not claimed. The prior standalone PR green and earlier `f281c6c0` focused results remain historical evidence, not proof of this new integration.

[Updated integration evidence](evidence/20261008-backend-idle-read-load/current-main-fc708-integration/summary.json) · [Independent review](evidence/20261008-backend-idle-read-load/current-main-fc708-integration/independent-review.md)

## Post-client integration for rollout — 2026-10-09 04:42 UTC

PR #546 merged into main `c3113a49e94e08ea4a3be5a75e1c962f34ac1aab`, tree `ccbca527dbb534e6ccbda06be1e7e20c808be27c`. Its source is identical to the already verified client head `9643af0`. Combining that main with backend head `259ec29` has no conflicts or overlapping client/backend paths, and yields tree `d97c01d9b8c80ed5e31505236b3b33ccecb8e0fc`. The anticipatory combined test snapshot and the actual post-merge combination match exactly; final source candidate is `8f13573ad91c817e73e7e93029ad98b94f330186`. No new implementation or protected AI planning/dedicated E2E edits were made.

This execution environment contained an older workspace snapshot and lacked the prior backend worktrees/receipts. Source and published CI evidence were retrieved again from GitHub. A fresh isolated `npm ci` installed 237 packages; all installed package hashes and 99 optional absences match the published package inventory. This is new verification, not a claim that missing local receipts survived.

- Combined focused suite: 549 passed across 30 files, cache disabled, exit 0.
- Fresh app/Worker types with regenerated runtime types, production build (9.43 seconds), and all eight unchanged bundle guards passed.
- Standalone offline audit scripts passed four snapshot race/resume cases and 33 retention comparisons, four probe races and three failure cases. Retention baseline was pinned to client head9643, whose source exactly matches merged main. No external requests or repository source writes occurred.
- All 1,871 tracked non-documentation input hashes are unchanged before/after.
- Next: publish this combination on the existing PR, follow exact-head full CI/browser/visual/quality to completion, then perform the approved normal main merge and automatic Pages verification. Manual production Worker deployment remains a separate approval/authentication step. A Pages result is not evidence of the scheduled Worker's deployed version or billing impact.

[Combined verification evidence](evidence/20261008-backend-idle-read-load/post-client-integration-20261009/summary.json)

## Public evidence handling

The public evidence substitutes named placeholders for ephemeral checkout, dependency, runtime and generated-output directories. The unmodified evidence is retained locally. [Path normalization](evidence/20261008-backend-idle-read-load/path-normalization.json) records each original/public SHA-256 and the precise transformation purpose. Package names, versions, per-package hashes, missing/optional classifications, source hashes, all 32 scenario observations, modeled totals and mutation/progress comparisons are unchanged. The summary identifies both the original and public manifest/log hashes. This is a documentation-only serialization change, not another test run or a runtime change. Generic `/tmp` reproduction examples remain usable.

## Deferred semantic issue

The unchanged retention guard compares decoded timestamp strings lexically. Whole-second formatting can delay cleanup within the same second; microsecond values or malformed legacy strings expose additional defensive edge cases, but their presence in production is unverified. Normal inspected writers emit millisecond ISO timestamps, so an early-delete microsecond value is not established on those paths. A typed backend range would also change the current stop-at-malformed-head behavior. Keep any timestamp-semantic repair a separate explicit contract and test scope; this patch only reduces read load. See [independent safety review](evidence/20261008-backend-idle-read-load/review.md).
