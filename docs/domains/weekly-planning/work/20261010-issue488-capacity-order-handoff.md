# Issue 488 capacity-order test preparation

Status: active implementation; focused red/green and mutation controls verified, broader/final verification pending

- Owner: Issue #488. Preserved source: Draft PR #563 at `e901fa843371d6a313b77f007bcf274a88d96da5`.
- Local branch: `fix/issue488-capacity-order`.
- Original preparation base: `9f0e0911ba1dbd9caca9836b613a8c438647fc09`; current HEAD/base after the authorized fast-forwards: `ee815b476ab4c5d5c217e27846550131af544270`.
- Scope: order-dependent capacity failure, dependency-safe bounded retry, and stable task ordering after workload correction.
- Read-only preflight on 2026-10-10 04:47 UTC: Issue #488 latest checkpoint, ten open PRs, related open/closed PRs and Issues, all 47 remote branches plus terminal page, and local U0/A/C branches. No separate F1 owner/branch/PR found. Existing source PR stays preserved; U0/A/C stay with their current owners.
- Main and source AGENTS are identical and have been read. The independent repository was materialized from the preserved bundle using its explicit backup refs. No writes to the original, U0, A, C, or R0 repositories.
- The earlier preparation-only checkpoints below remain historical. The current authorized implementation and verification state is recorded in the latest checkpoint. Publication and shared-history changes remain with the integration owner.

## Next action and exit criteria

Prepare a feasible two-day positive witness, a relation-inversion negative witness, first-pass-success preservation, hard-bound/partial controls, and a real workload-correction ordering witness using existing test helpers. Review the exact test-only diff and record unexecuted expected outcomes. Do not report red/green results until the authorized execution owner actually runs them.

Implementation must reuse the existing relation-ordering owner. A deadline-only retry can place a successor before its predecessor and is not an acceptable fix. Main's ordinary all-or-nothing result, typed quantity, temporal/busy/capacity boundaries and source preservation remain required.

## Prepared checkpoint, 2026-10-10 04:51 UTC

Two existing test files contain 12 additional parameter-expanded cases. No new test framework or shared fixture was introduced.

- `weeklyPlanningStableV5PlacementEngineAdversarial.test.ts`: feasible two-day deadline rescue; four impossible dependency-direction controls; feasible rescue with a separate predecessor/successor pair; exact first-pass success preservation; three daily-capacity/unavailable/notBefore controls including ordinary versus retained partial output; a real workload-replacement transaction followed by active projection, work compilation and placement.
- `weeklyPlanningGenericWorkItems.test.ts`: task-array order with two work items in the same task, keeping their internal order and leaving the graph unchanged.
- Expected, not observed: fixed main lacks the two rescue behaviors and two task-order guarantees. Source's deadline-only retry is expected to violate the four impossible dependency controls. The other cases preserve existing behavior. These are hypotheses until execution.
- Static exact-diff review and `git diff --check` succeeded. No production/config/lockfile change. Dependencies are absent; tests, typechecks, build, model/browser, trace and save gates remain unexecuted.
- Reuse these tests on the implementation branch; do not merge test-only preparation as if it were the fix. After A/C integration, refresh the base and use their existing accepted-state/preview owners rather than copying their production hunks.

The preparation is complete when the test-only patch and exact state are handed to the integration owner. Product completion still requires the implementation, observed red/green controls and all applicable exact-content gates in the capacity slice plan.

## Fixture-strengthening checkpoint, 2026-10-10 06:27 UTC

The root owner handed this existing branch to the C/F2 worker for the two narrowly identified test-fixture gaps. C/A candidates and the shared combined four-case patch remain separate. Issue #488 restart comment 6093252062 was re-fetched at its 06:23 UTC revision, together with ten open PRs, related historical PRs, all 48 remote branches and the terminal page. No overlapping F1 implementation owner or new branch was found. This is continuation of the existing F1 preparation, not another implementation branch.

Before any edit, the two dirty tests and untracked checkpoint were preserved as a binary patch, tar and SHA-256 manifest in shared `capacity-fixture-strengthening/`. The original prepared patch remains unchanged. The private repository fetched exactly `4bf4ad167ff9d07c740d0a732f9508e92e2f1765` from the existing U0 clone and fast-forwarded normally; all three dirty inputs were byte-preserved. README, Worker wrangler origin configuration, and the domain-origin test exactly match that main commit. U0's local origin/main at 5e19b3ed was checked and is an older ancestor, not evidence of a newer main.

The same 12 additional cases remain; only the existing adversarial suite was strengthened:

- The positive rescue now has a hard 60-minute daily limit on both days. A's Monday load from the failed first attempt must be discarded before B can occupy Monday on retry. This isolates fresh dayLoads in addition to the existing fresh-busy observation.
- The daily-capacity and unavailable-time controls no longer include priority_over(A,B). They admit the genuinely different [B,A] retry, which fails with a B-only partial instead of the first pass's A-only partial. Existing exact A-only / unscheduled-B assertions must retain the first pass, not adopt or mix the failed retry.
- The notBefore control keeps priority_over(A,B), explicitly covering unchanged-order / priority preservation; it is not claimed as evidence that retry ran.
- Existing assertions, the other test file, case count, production, package/lock/config and dependencies are unchanged. Metadata/tie/component rows were not added without an independent demonstrated need.

Static diff checking and exact-input preservation succeeded. No test collection, tests, typecheck, build, browser/model or dependency operation has run. The strengthened fixtures are static fault-detector predictions, not observed red/green results. Next: wait for the root's baseline execution slot, record the exact toolchain/installed dependencies and commands, then run the existing two-suite main baseline before any production change.

## Baseline execution handoff, 2026-10-10 07:52 UTC

The integration owner handed this same F1 branch to the storage/integration worker for the first baseline. The previous fixture owner confirmed that editing stopped at 06:27. Issue #488 comment 6093252062 (updated 07:46 UTC), ten open PRs, related open/closed capacity/deadline PRs and Issues, and all 49 remote branches plus the empty terminal page were checked. No separate F1 implementation or PR exists. No new branch/Issue/PR was created.

The exact strengthened two-test patch, all three dirty input files and parent `4bf4ad167ff9d07c740d0a732f9508e92e2f1765` were preserved in shared `capacity-baseline-preflight/` and local ref `refs/backups/issue488-capacity/20261010-pre-ee815-main`. The patch SHA-256 remains `2b1558fb29974c69558809c16e470e977047b97bc314a478a6c4e7497b17fd3e`. The existing private clone fetched only exact `ee815b476ab4c5d5c217e27846550131af544270` from the A clone and integrated it by ordinary fast-forward; the three prepared inputs were byte-identical before/after that operation. This brings merged U0 into the baseline without applying unmerged A/C/R0 behavior. The current production tree is exactly main ee815b; no production fix has been made.

The candidate still has no node_modules. Its package.json and lockfile match the existing physical main-baseline dependency donor. Before the root-authorized slot: no dependency copy, npm, collection, test, typecheck or build. When the slot is granted, materialize a private dependency copy and verify its actual installed-package manifests against the donor; record Node22.23.0 binary, npm identity, package/lock/config/source/test hashes, command, result and before/after identity. Run both existing suites (the 12 added cases plus their pre-existing controls), without changing assertions or timeouts, before any production edit.

The strengthened positive rescue now detects leaked daily loads and busy state; the two changed failed-retry rows distinguish first-pass and retry partials. First-pass preservation currently pins placement fields, not every metadata byte. Deadline ties/component scope are not yet established by these 12 cases. These limits remain explicit and may need a small additional witness when the actual baseline identifies the necessary implementation. The prepared script and independent static review are preparation only, not red/green evidence.

## Observed baseline and implementation, 2026-10-10 08:02 UTC

The first baseline ran against main `ee815b476ab4c5d5c217e27846550131af544270` plus the unchanged two-test patch `2b1558fb29974c69558809c16e470e977047b97bc314a478a6c4e7497b17fd3e`. Node 22.23.0 / Vitest 3.2.7, one worker and no file parallelism: two suites, 25 tests, 21 passed / 4 failed / no skips, exit 1, 1.95 seconds. All 13 pre-existing cases passed. Of the 12 additional cases, eight controls passed and four observed defects failed: two feasible deadline-order rescues returned insufficient capacity; two compiler assertions exposed task ordering changing with workload history. This is observed red evidence, not a passing implementation gate.

The private dependency copy came from a local donor with byte-identical package/lock files. All 235 installed package manifests matched the donor, with separate physical inodes and internal-only symlinks. All 2,329 tracked/untracked input hashes and all installed manifests were unchanged across execution; donor manifests were also unchanged. npm 11.9.0 was recorded, so the local toolchain is not claimed to be identical to CI's npm. Logs, JSON results, command, before/after manifests and the baseline receipt are retained in shared `capacity-baseline-preflight/` (receipt SHA-256 `ebcd4885cd52f149538117542f9870db4bb9fe4c5c1534ae795102ea68f73dc1`).

The implementation draft changes three production owners only. The work compiler stably groups newly constructed items by the supplied active task order, without mutating graph history or changing workload identity/quantity. Placement preserves its ordinary first attempt. After failure it may try one different compiled-hard-end order, passed through the existing relation-ordering owner; that owner accepts the three relation fields it actually uses. Each attempt constructs fresh busy reservations, daily loads and candidates. Only a fully successful retry replaces the initial result. No dependency, schema, provider, storage, UI, MonthEvent or session-splitting change is included.

The original 25 assertions/cases are preserved. Independent static review and implementation verification are pending. The old main result's full candidate metadata was not captured by the placement-only success oracle, and no full-result identity claim is made. Trace persistence for actual rescued candidates and the remaining scheduling regressions must be verified before integration. No implementation test, typecheck, full verification, build or browser/model result is yet claimed.

At the next static checkpoint, the independent review found no production blocker in the three-file draft (`6a580dd423505934fb1163260e782bc05ae595f5ebf7e650fd42a08b55939ee1`). The existing successful-first-pass case now also specifies the complete expected result, including identity/provenance/approval metadata; that stronger oracle still needs its own main control before it becomes baseline evidence. One case was added to the existing capacity trace suite: real work compilation and PreviewExecution produce the rescued candidates and debug event, then injected append failure/retry, Worker preparation, byte limits, an unknown future-field sentinel and oversized diagnostic stress exercise the existing persistence boundaries. These additions and the scheduling-policy update do not change the three production files. They remain unexecuted. Busy-state and day-load leakage must be mutated separately when checking detector strength.

## Focused red/green checkpoint, 2026-10-10 08:21 UTC

The frozen v2 candidate ran under Node 22.23.0 / Vitest 3.2.7 with one worker and no file parallelism. Its three production files are still the independently reviewed patch above; no implementation edits were needed after the first main baseline.

- Exact main `ee815b` production blobs plus the strengthened full-result success oracle: 1 selected case passed, 14 cases unselected, exit 0. This now confirms the complete expected first-success object against main, including provenance, keys and approval metadata.
- Restored candidate: 3 suites / 27 tests passed, none skipped, exit 0, 11.22 seconds. All original 25 cases passed. The existing capacity trace case and the new real deadline-rescue trace case both passed; the latter took 165 ms and exercised durable outbox retry, Worker preparation, size bounds, future sentinel and oversized diagnostic handling.
- Independent intentional faults were each detected by assertion failures: relation-order bypass 4 failures; shared busy state 1 failure; shared day-load state 1 failure; adopting a failed retry 2 failures; reordering an already successful first attempt 1 failure. These are mutation-control successes, not failures of the restored candidate. Targeted runs intentionally left unrelated cases unselected.

Before the controls, all eight changed input files were separately archived. Every run recorded command, actual mutated production hashes, result and before/after input/dependency checks. Each control restored the candidate in a finally boundary; all 2,329 source/config/test/doc input hashes and 235 installed-package manifest identities matched the frozen candidate at the end. The runner exited 0 and `git diff --check` passed. Evidence is in shared `capacity-baseline-preflight/focused-and-mutations-receipt.json`, SHA-256 `0ed8e2cacce45623e5651c8884baa7feeee70b08c62aeeae19a690eba3058f24`, with individual logs/JSON results and archive proof. This later checkpoint-only documentation edit is separate from that runtime/test evidence.

Fresh typechecks, broader regressions, final full verification/build and any applicable UI/integration gates remain pending. No remote branch or PR was created, and no result here is a final merge-ready claim.
