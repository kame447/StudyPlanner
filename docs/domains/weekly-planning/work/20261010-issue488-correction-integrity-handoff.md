# Issue #488 correction integrity checkpoint

Status: local candidate; no external write, PR or release approval.
Base: `9f0e0911ba1dbd9caca9836b613a8c438647fc09`.
Branch: `fix/issue488-correction-integrity`.
Comparison source: immutable `e901fa843371d6a313b77f007bcf274a88d96da5` / PR #563.

## Scope and preserved boundaries

Preflight refreshed #488/#461 comments, open PRs, all 46 branches and remote main at 2026-10-10 03:46 UTC. No competing correction slice. #461 remains incident confirmation; #485 ordering and #139/#146 migration policy remain baseline.

The 11 planned production paths cover shared workload-dependent migration, same-transaction correction identity, typed window-dependent reconciliation and one final write-reference guard. Existing schemas, saved validators, prompts, renderer, interaction mode, placement, storage and UI production are unchanged. Four isolated workflow/browser-test paths supply the necessary real-model/UI gate; their static review does not count as browser/model acceptance.

Key integration adaptations beyond source copying:

- Workload replace/modify intents preserve paired effort references only for this turn's corrections. Equivalent migrated replacements consume the explicit intent with its normal operation key, without self-supersession or duplicate carry.
- Amount-dependent effort invalidation records exact transaction-local retirement provenance. Only an explicit replacement targeting that replacement workload, or explicit removal, may consume it once. Earlier removed/superseded targets and repeated authorization remain invalid.
- Typed planning-window uncertainty reconciliation is the sole lifecycle owner; generic contextual cleanup does not remove a carried question or repeat a typed removal. Main #485 explicit-window ordering remains intact.
- One final commit guard rejects newly introduced inactive operational edges by source fact, target fact and source property. Inherited invalid edges remain readable; historical correction/decision evidence is not an operational edge. Rejection returns original graph/null diff.
- Meaningful uninstalled support/container content rejects atomically instead of being pruned. Workload corrections retain accepted task/component ownership; this adds no task/material rename support.

Private dependency copy: all 235 installed lock entries matched exact versions, with no missing nonoptional packages. Lock SHA-256 `af5b37bbcc990a528621a18f545142430f8b9506460dde03f3f9be80fbb4b9ab`. No shared installation writes.

## Reproduction and verification chronology

1. Unchanged-main red, four files: 13 failed / 14 passed, exit 1. It reproduced dangling pace/session references, stale total effort, unsupported dependent acceptance, paired correction failure, silent support loss, and identical-window question deletion. Existing #485 controls passed. Current-main migration result witness matched `9b3143aeabd282e56bea15436266aa902ef80242057ce361bc9d84ead0e91b4c`.
2. Initial implementation, ten files: 92 passed / 4 failed. One new total-duration ordering defect required the exact retirement provenance above. Three trace failures came from the test role-answer local ID not identifying the pending workload; fixture routing was corrected without changing production routing or weakening assertions.
3. Corrected focused run, ten files: 95 passed, exit 0. This covered pipeline-generated effects, session codec/storage/hydration, duplicate replay, failed trace append, durable outbox retry and Worker payload preparation. Later test additions are not included in this count.
4. First broader run, 48 files: 246 passed / 1 failed. The only failure was the historical-owner fixture's previously silently pruned differing labels. First app typecheck also found test-only `Array.at` incompatible with main's configured target; indexed access fixed it without compiler changes.
5. Second broader run, 48 files: 249 passed / 1 failed. New total-retirement modify/remove/order/third-correction controls and paired-total persistence/trace passed. Making the historical fixture same-name exposed main's existing public binding requirement; adding a binding would destroy the terminal-owner mismatch oracle. That label-only adaptation was withdrawn.
6. Fresh app and Worker typechecks passed, exit 0, before the final historical-fixture adjustment. Wrangler generated runtime types successfully but its default home log path was unwritable; subsequent runs use a writable local log path.

## Historical saved-reference witness

The #345 contract concerns retained terminal effort provenance, not acceptance of a task/material rename. A separate read-only-baseline copy of main `9f0e0911` ran the original `weeklyPlanningTaskReferenceOwnershipV5.test.ts` case with only a graph-output statement added: 1 passed / 2 skipped, exit 0 (2026-10-10 04:18 UTC). The original differing-label input passed the public validators and main produced the historical graph.

The actual graph is 9,280 compact UTF-8 bytes / 12,568 pretty bytes / 436 lines, with three tasks, 17 lifecycle entries and revision 8. Whole-graph `JSON.stringify` SHA-256:

`e84fb3720d8452a7ade752d3aa06509c96b4fbbc856c307c721ca083973aa3a9`

Evidence files: `old-main-terminal-witness.log`, `old-main-terminal-witness.json` and `old-main-witness-source-integrity.json` in the local `issue488-correction-evidence-20261010` directory. The baseline copy's production source was checked against the immutable main commit. No immutable source or main branch was edited.

The current regression first asserts the original input still passes public reference validation but the new finalizer rejects the uninstalled meaningful container atomically. Its separate retained-checkpoint fixture reconstructs the old lifecycle using identity-neutral temporary labels, restores only the retired containers' historical labels, and must match the independently frozen whole-graph hash above. All original task-owner mismatch, removed/superseded provenance, strict malformed-reference/status rejection and actual codec round-trip assertions remain. This is historical-read compatibility evidence, not current public-write acceptance. The compact constructor avoids committing a 436-line generated graph.

## Remaining gates at the initial checkpoint (historical)

The final historical fixture passed 4 files / 53 focused tests, including the fixed old-main whole-graph hash. The same source snapshot then passed 48 files / 250 broader regression tests and fresh app/Worker typechecks (all exit 0). The writable Wrangler log path removed the earlier logging error. After those runs, one unused six-line production diagnostic export was removed and its window tests switched to explicit scanner-edge assertions. Runtime guard semantics are unchanged, but the final source hash has not yet been tested. The next serialized slot runs focused tests and full `npm run verify` on the checkpoint commit; prior green counts are historical evidence, not verification of that final hash. Independent review has found no production blocker; final exact snapshot review remains required. Full `npm run verify`, applicable security/bundle checks, browser and actual-model/UI acceptance are unrun and root-owned. The four gate paths passed syntax/YAML/config/secret-free collection checks only. No model calls, production Firestore, remote push, PR or merge have occurred.

## Exact-checkpoint aggregate run and fixture placement correction

Checkpoint `3189f4beaf995884ff7a36bac35f30921c775225` passed 11 files / 101 focused tests. Its full `npm run verify` passed fresh app/Worker types, then finished with 796 passed / 10 skipped / 1 failed files; 6,663 passed / 45 skipped / 1 todo / 1 failed tests. The sole failure was the unchanged Stable V5 production-isolation scanner correctly rejecting four imports from two new helpers placed outside a test-only directory. The existing whole-source isolation scan passed in 2.693 seconds; this was not a timeout. Build did not run after the test failure.

The two helpers are now under the existing `testUtils/__tests__/` convention and test imports point there. Production logic, import allowlists, assertions and timeouts are unchanged. The helper files retain ordinary `.ts` names, so the existing Vitest `*.{test,spec}.*` include does not discover them as test suites. They are imported only by tests and by the other helper. The placement-only change passed 12 files / 102 focused tests, including the unchanged production-isolation test. Full verification on its final checkpoint remains pending.

The exact-run receipt records Node/npm, all 235 installed package versions, unchanged lock SHA, commit/tree, 30 changed-path hashes and environment. Runs used `DEV_LAN_HOST=127.0.0.1`, Vitest fork/thread maximum 2 and minimum 1, metrics disabled, and a writable Wrangler log directory. No assertion or timeout was changed.

## Placement checkpoint and functional-runner watchdog

Checkpoint `886f6ec8a7e3b8d69b6ee59b7e732485564fdd53` passed fresh app/Worker types. Its full suite again discovered 807 files, confirming no extra helper suites: 796 passed / 10 skipped / 1 failed files; 6,663 passed / 45 skipped / 1 todo / 1 failed tests. The fixture production-isolation check passed. The only failure was the unchanged numeric paired harness's complete 16-arm functional case reaching Vitest's default 5-second runner watchdog (5.343 seconds); the same production code and 2/1 environment had passed it in 1.331 seconds on the previous full run. The whole-source isolation scan passed in 2.239 seconds. No product assertion failed. Full verification is not recorded as successful.

Independent diagnosis distinguishes functional coverage from a performance assertion: these two cases verify complete source isolation and all numeric cardinality/arm results, with no 5-second product SLA assertion. The root-approved shared patch gives only those two cases a finite 15-second runner watchdog, with explanatory comments. It preserves every test body/assertion, the complete source scan and all 16 arms; global timeout, skip, retry and production code are unchanged. The patched checkpoint still needs focused and complete verification.

An independent `npm run build` on exact `886f6ec8` passed. The unchanged bundle guard failed only aggregate JavaScript raw/gzip: 2,273,306 / 612,134 bytes, versus main's 2,263,870 / 609,511 on the same locked toolchain (+9,436 / +2,623). Both have 28 chunks; all CSS metrics are unchanged. Capacity is recorded as a separate issue under the user's direction and does not replace behavioral verification. Budget values/checks were not changed. Logs, receipts and the main comparison are retained in the local evidence directory.

## Latest main and Node 22 aggregate checkpoint

Main `4bf4ad167ff9d07c740d0a732f9508e92e2f1765` was incorporated by normal merge at `a42ad827a5fa2232e90ce655b3bd44edae291706`. Its README, Worker origin configuration and three domain-origin tests are byte-identical to main. The 11 correction production paths remain identical to the reviewed unit; no history was rewritten.

Exact clean `a42ad827` on repository Node 22.23.0 passed the two watchdog suites and new main domain suite (3 files / 8 tests), then `npm run verify` exit 0: fresh app/Worker types, 798 passed / 10 skipped files; 6,667 passed / 45 skipped / 1 todo tests; production build passed. Runtime verification ran 2026-10-10 06:00:45–06:10:33 UTC. The 32 changed inputs, preserved main files, lock and all 235 installed packages were checked before and after. Vitest retained maximum 2/minimum 1 forks/threads, DEV_LAN_HOST=127.0.0.1; npm 11.9.0/OS/workers are not claimed identical to CI. Receipt: `exact-a42ad827-node22-verification-receipt.json` in the local evidence directory.

The unchanged budget again reports only aggregate JavaScript overage (2,273,306 raw / 612,134 gzip bytes, 28 chunks). CSS and all other limits pass. Capacity remains separately tracked under the user's explicit direction; no guard was weakened.

## Actual-model/UI oracle correction after the aggregate checkpoint

Independent static review found that the original paired scenario kept the same total effort and only inspected graph facts, so stale preview output could pass. The existing two-scenario gate now changes 20 problems × 3 minutes to 40 × 2: the existing 1.1 safety buffer and 15-minute rounding allocate 90 minutes, versus the initial 70. It asserts clock/duration/estimate consistency, current graph revision/owner/task/workload/pace provenance, no retired source facts, no old candidate key, and an actual same-turn dependent workload/effort replacement seam. The session-duration fact remains checked without inventing a new problem-workload chunk-cap behavior. Promotion must still leave durable plans empty until explicit save.

The window case requires the actual question Q to point to an active window W and the pending context to point to Q in the correction request; continuation must resolve the new range and retire Q. Legal model outputs that do not exercise these targeted seams are coverage-incomplete, not a reason to change product semantics.

Only the explicit real-API harness profile enables existing local renderer traces; Firebase configuration stays empty and browser external requests remain blocked. The observer accepts the existing local diagnostic or durable retry outbox and records which supplied evidence. A known local diagnostic ownership mismatch can put the authentic input in that outbox; observing renderer adoption there does not prove trace delivery. Owner/conversation/request/user-text identity, renderer action/AI branch, same-turn real provider output, committed assistant text and actual DOM must agree. Screenshots and synthetic outputs support separate human naturalness review. No production collector/export or model-response transformation was added.

After the two gate-file edits, syntax/diff checks and secret-free Playwright collection passed (explicit profile 1 test, ordinary profile 54 tests). An ephemeral Node probe evaluated the actual spec's four pure assertion functions: 2 positive controls passed and 10 injected stale-preview/reference/identity/paired-correction faults were rejected. Receipt: `real-api-oracle-verification-receipt.json`. This proves oracle sensitivity only, not browser, provider, or production pipeline behavior. The prior aggregate proves exact a42; the subsequent changes are test-gate/document-only and await the final combined verification and actual-model/real-App gate owned by root.
