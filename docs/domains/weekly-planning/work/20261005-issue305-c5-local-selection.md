# Issue #305 r2-D — C5 local selection

Status: PoC complete / awaiting parent integration and external audit; adoption HOLD
Owner: VividLinnaeus; integration: BronzeMaxwell; audit: CopperHopper
Branch: `feat/issue305-c5-local-selection`
Base / HEAD: `8e62377e0c59d8b5ac820358781a8c3584433a9a`
PR: none. Parent owns commit/push/GitHub writes.

Decision owner: runtime `jev-owner-decisions-approved.md`, DECISION 3.
Acceptance owner: [Phase B contract](20261004-issue305-jev-hierarchical-input-interpretation.md).

## Scope and completion

Only an existing fresh `ambiguous_effort_estimate` question for one non-completed workload, with active candidates directly bound to that workload and the same measurement/unit. Keep the selected existing fact; supersede only the question's fixed competing cohort. Preserve all fact contents/provenance and every unrelated workload projection. Broad facts, observed pace, alternate measurement, historical resurrection, ordinal/deictic, and extra meaning fall back with the whole utterance. Planning-window selection remains HOLD.

Complete when question-time immutable payload and sibling durable consumption ledger, answer-bound Unit 2 manifest, synchronous controller/reducer application and rollback, persistence/recovery tests, trace exclusion/persistence contract, no-API paired evaluation design, focused tests/typecheck/final verify, exact-content report, and parent mail handoff are ready. Defaults remain disconnected; production activation/adoption is outside this unit.

## Alternatives and falsifiers

1. Retain selected active fact and supersede only directly workload-bound competing facts. Existing lifecycle engine supports this; reject if whole-workload before/after projection shows any outside effect. Chosen for the narrow PoC.
2. Copy a chosen value into a fresh semantic fact and infer corrections. Would introduce new provenance and replacement semantics; fails if copied history is presented as current evidence or the correction guard requires new fact construction. Rejected as unnecessary.
3. Global retirement or a workload override/split of a broad estimate. Could resolve the visible conflict, but changes another workload or requires a new precedence contract. Disallowed by DECISION 3.
4. HOLD everything because baseline lacks snapshot/ledger. Low change risk, but falsified by an existing narrow lifecycle operation plus an implementable atomic consumer. Missing foundation alone is not proof that this approved PoC cannot close.

What would make the chosen interpretation wrong? A directly bound non-completed estimate could still affect another resolver path, pending scope could fail to identify its cohort, or actual persistence/recovery could lose consumption. Those are gates, not assumptions of success.

## Checkpoint

- Read root/feature AGENTS, approved decisions, Phase B/Unit 2 records and closure/audit probes.
- Re-fetched Issue #305 latest checkpoint: this agent owns r2-D at the specified base; no existing C5 PR. Parent renamed branch. Worktree initially clean.
- Existing lifecycle operation is pure, rejects inactive facts and active dependents, and supports one-fact supersession. Estimation resolver proves direct workload candidates do not match other workloads; all workload projections will still be checked.
- Existing persistence runs after commit as best effort. C5 cannot reuse that as durable success; storage acknowledgement/recovery must be explicit.
- Narrow domain plan, question snapshot, sibling ledger, real controller/reducer/runtime checkpoint and unknown recovery are implemented behind an explicit injected option. No application caller enables it.
- Focused controller/Unit 2/codec/reducer/question tests passed at intermediate checkpoints. Latest C5 tests: 31 actual-controller cases, one trace transport case and one no-API evaluation preparation case. Typecheck passed during implementation. First full verify failed with 4,438 tests passed / 2 failed: existing controller identity (fixed, focused regression green) and the separate Stable V5 production import allowlist. Parent #2460 authorized exact-file entries with reasons, plus a new guard against production imports of the two test-only helpers; both isolation gates and the original controller test now pass. Final `WRANGLER_HIDE_BANNER=true WRANGLER_LOG_PATH=/private/tmp/c5-r2-wrangler.log npm run verify` passed (exit 0): fresh app/Worker types, 4,443 passed / 45 skipped / 1 todo, production build. Baseline live/provider skips were not counted as evaluation evidence.
- First failures were classified: a test double returned candidate IDs instead of menu option IDs; strict candidate serialization was incorrectly used on optional application-state fields; an evaluation fixture spread extra basis keys into binding. Fixed the relevant harness/application layers; candidate schema and assertions were retained.
- Final verified code-map SHA-256: `72a6806f40ea3987c5e4b7ea42db38d623a9049f00ea61686337ca11125a9a5c`. Verification input manifest and final report live under runtime `jev-impl-reports/r2/c5-local-selection*`; log: `/private/tmp/c5-r2-verify-final.log`. Final audit added two three-candidate actual-consumer regressions (hierarchy success and access revocation after parent); focused checks and the updated full verify both passed. Post-run changes are documentation/report only.
- Local completion criteria met. Next owner: BronzeMaxwell integration, CopperHopper external audit; real provider/census/continuation integration and independently approved evaluation remain HOLD. No paid/provider evaluation ran.

## Narrow closure and held counterexamples

The represented value is the effort of **one target/remaining workload**, not every estimate under its task. Eligibility requires exactly one machine pending question; an unaccompanied deterministic presentation bound by #348; all question sources marked user-origin; and at least two active direct workload estimates in the actual resolver's ambiguous cohort with identical measurement/unit. Intrinsic minute/hour workloads, completed/observed-pace sources, broad targets and alternate roles remain outside this PoC.

The existing matching contract (`semantic/weeklyPlanningGenericWorkEstimation.ts:40`) permits a task/component-bound estimate to affect several workloads. Example: task A has workloads W1/W2 and competing task-bound estimates 5/7 minutes per problem. Selecting 7 for W1 and globally superseding 5 also changes W2; copying 7 to W1 can leave two broad estimates matching. Neither is a local replacement without a new override/split contract. `narrowC5EffortBasis` rejects this entire population. The pure plan compares the actual resolver result for **every** other non-scope-total workload, including completed work and observed pace, before/after; it requires one unambiguous chosen source for the affected workload.

The lifecycle engine already expresses the approved narrow replacement (`semantic/weeklyPlanningFactLifecycleEngineV5.ts:137`): active losers point to the retained active winner, active dependents reject the operation, and fact contents/provenance remain unchanged. No new fact is fabricated, no superseded fact becomes active, and no override precedence is invented. All losers are planned on a private graph before any actual mutation.

Planning windows remain HOLD, not a claim of frequency zero. `semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5.ts:34` collapses multiple active windows after successful applied canonicalization, retaining an added/latest window and superseding the others. An example with an older window A and newer B cannot be made into a live C5 population by reviving A or disabling that invariant. Hydration/no-apply paths could differ; a surviving fresh question and an authorized represented cohort have not been established. This PoC does not enumerate windows.

## Responsibility and transaction

- `c5LocalSelection/basis.ts`: pure domain eligibility, complete value/scope tuples and strict persisted-record decoders. Sources/provenance are internal; provider projection contains question code, target and relevant scope, no original source text or owner/access metadata.
- `contracts.ts`: optional version-1 question snapshot; sibling version-1 consumption ledger. Candidate order, IDs, cohort, complete workload/estimate tuples, question presentation, graph revision and epoch are frozen. `payloadSerialization` names those exact question-time bytes. At answer time only the answer request/input revision is added to create the Unit 2 manifest/hash; live enumeration is used solely as an independent equality/freshness check.
- `selection.ts`: Unit 2 keeps staged capability/hash/epoch to the consumer; narrow pure plan uses the existing lifecycle engine. Last synchronous prepare rechecks complete live basis, #348 turn-start binding and expected #270 begin transition, access, ledger and affected/unaffected resolvers. The reducer receipt is opaque, process-local, scoped to the entire current planning state and single-use.
- `controlledCommit.ts`: actual runtime finalize receipt, actual reducer `commit_turn`, and a synchronous graph+state+ledger checkpoint. Rejected reducer or known failed persistence restores the pre-turn full state and graph. No await occurs between final reread and durable outcome. Unknown dispatch/write/read results hold the turn and inspect the same receipt; no new choice or graph operation runs. New turns/cancel/clear/reset through the controller are blocked during recovery. Intervening state/graph cannot be overwritten by rollback or receipt recovery.
- `checkpoint.ts`: acknowledged read-back of exact attempted envelope bytes; write-then-throw is recognized as committed. Quota reduction trims messages only, preserves the entire ledger, and stops on unknown write outcome. Successful read-back is required for local success, independent of existing best-effort callbacks.
- Session codec: strict outer `requiredCapabilities: ['c5-local-selection-v1']`. Baseline strict readers reject the extension rather than silently discarding consumption. Legacy envelopes retain normal V5 usability but discard any extension-shaped records and are ineligible until a new actual presenting commit. Unknown capability/corrupt payload fail closed. Current ordinary Luna turns retain the sibling application ledger even when their projected intake replaces the pending question or the opt-in is removed.
- Controller insertion precedes the first generic execution. Without the explicit option it executes the existing path. Choice abstention returns the same complete user channel and supplemental channel to that path; it does not split clauses. No normalizer, Worker or provider port file is changed here.

`commitControlledCandidateTurn` and `prepareLocalCandidateReducerCommit` expose a structural reuse boundary requested by E and approved by the parent. The latter still demands Unit 2's real staged capability, strict current ledger and full atomic view; callback/type names alone grant no authority. E's D5 adapter is in its own worktree and remains test-double-only until parent integration. All generic consumer receipts currently use the C5-named sibling record; rename/generalization is not needed for this PoC.

`continueSelectedTurn` is an explicitly injected **application** continuation. It must own existing question/readiness/scheduler/preview/renderer decisions and preserve authorization intent. No production continuation or calibrated provider is installed. Tests use the actual estimator with a narrow application result double, then the actual controller/reducer/runtime/storage. They prove local formal containment and durability; they do not prove the complete production planner/dialogue continuation or semantic provider accuracy.

## Trace contract

At actual durable success, the module emits the existing branch event and an existing canonicalization event carrying an operation summary: route, candidate count and durable-consumption boolean. The real trace builder retains these through client budget, append failure, persistent outbox, reset/retry, Worker preparation and server budget. The regression also checks a future nested field and a large future value with explicit truncation.

Question payload, provenance/source text, answer-bound manifest/hash/epoch capability and consumption keys are intentionally excluded **before** diagnostic/outbox emission. These records authorize or describe scoped application mutation and may duplicate private historical text; counts/outcome are the diagnostic alternative. The session codec persists them locally for recovery. This exclusion is checked on actual emitted events and queued bytes, not merely on a projected object. Existing question-context trace stripping removes the C5 subrecord with presentation binding. Provider-wire diagnostics/census join are E/A integration responsibilities; this PoC has no real provider traffic.

## Paired evaluation preregistration draft — execution HOLD

Authority: owner DECISION 3 and Phase B acceptance remain unchanged. This is a draft, not approval, fresh accuracy evidence, a gold dataset or a live execution grant. Before any real/paying call, parent/owner and CopperHopper must approve corpus IDs/hash, group roles, exact provider/catalog versions, menu policies, calibrated thresholds, cost cap, timing/dispatch collection and acceptance numbers. No such evaluation was executed.

Hypotheses: complete-tuple flat Choice is the primary comparator; hierarchy is useful only if the same full leaves and gates produce a measurable whole-turn improvement. Luna alone is the product baseline. No assumed reduction is assigned to a turn that abstains, makes an incorrect acceptance, omits a candidate or has unknown closure. With two candidates hierarchy can equal flat and is not expected to create a reduction merely from its name.

Population and provenance:

1. Use a fresh sealed independently authored holdout, grouped by source/session/meaning family, with paired minimal changes for target, measurement/unit role, scope/range/negation/approximation, current versus historical assertion, positive+negative/mixed clauses, ordinal/deictic and same value/different target. Owner-approved census determines deployment population/coverage separately; no extra real-user collection is authorized here.
2. Calibration is a disjoint group and sets thresholds for each leaves/groups × option count × depth, including none and auxiliary extra-meaning gates. Consumed fixtures and synthetic structural cases are diagnostic only. No model judge label is gold; human/adjudicated labels must record provenance and ambiguity.
3. Include ineligible populations (broad/completed/pace/window/absent snapshot/old sessions) in product denominator and fallback cost. Cardinality cohorts begin 2/3 and extend to supported flat option limit if fresh natural cases exist; synthetic stress cannot establish natural frequency. Above flat limits is declared ineligible, not silently pruned.

Arms and isolation:

- `flat_complete_tuple`: all frozen full leaves + none in one catalog with the same minimal context, Unit 2 policy, domain binder, controller/reducer/checkpoint and application continuation.
- `hierarchy_same_leaves`: exactly the same ordered full leaves/context/gates/continuation; mechanical grouping only. All levels plus auxiliary vetoes and fallback count. No selected group commits a subset.
- `luna_only`: the current Stable V5 complete turn from the identical frozen planning state/graph/user channels/request clock, with its focused routes, repair, authorization audit and fallback intact. It is not a single mocked normalizer call.

`evaluationHarness.testUtils.ts` prepares isolated arm packets with exact original-state and leaf identities, accepts an explicit approved runner, and audits complete leaf retention in actual outgoing menus. The structural test proves isolation and omitted-candidate/qualifier detection. It does not execute an evaluation. Use balanced randomized order across paired cases, isolated runtime/storage/provider scopes, and identical turn-start bindings. Output state, affected/unaffected resolver projections and durable consumption must be scored jointly.

Endpoints and decision rule draft:

- Primary safety: accepted meaning/effect correctness, exact target/field/scope binding, critical unauthorized or partial mutation, and preservation of unrelated evidence. Any critical accepted false/partial mutation is a stop/HOLD; owner and auditor must lock an independent false-acceptance ceiling and uncertainty rule before running. Abstention is reported, never scored as a correct selection by default.
- Primary benefit: whole semantic-turn provider-dispatch savings **and** independent correctness/coverage. Count every actual Jev/Luna dispatch, each auxiliary head, hierarchy level, auth/focused/audit/repair/retry/fallback and late shadow work; proxy requests are not provider calls. Closure must complete after all joined pending work settles; unjoined/missing observations remain unknown.
- Report paired rate/difference intervals (resample meaning-family/session groups) and selection coverage. Latency is measured from semantic ingress to complete semantic closure, not summed nested timings or inferred estimates. Report measured p50/p95 and paired intervals, provider/model/config versions, failures before/after dispatch and usage completeness.
- Missing input/output usage or pricing cost remains null/unknown, never zero. No latency, cost, reduction or accuracy value is invented here. Adoption remains HOLD until predeclared safety and practical benefit thresholds pass on fresh groups.
- Candidate omission, display/qualifier truncation and raw/history current-intent minimal-pair failures are losses even if fewer calls result. Persist every arm's validated formal outcome and trace/census exclusion contract; renderer-only calls remain outside semantic counts but no semantic background dispatch disappears.

## Remaining decisions and limits

Local-tab synchronous mutation plus one acknowledged localStorage envelope is the proved boundary. It is not multi-tab/device CAS, a remote permission transaction, crash-atomic memory rollback, or guaranteed recovery of an unreadable/corrupt external storage system. Remote source authorities require their own authoritative gate and CAS; they cannot be replaced by the local `sourceAccess` callback. The staged capability is process-local; only frozen payload and durable consumption are reloadable, never an old staged selection.

The generic real Choice port, whole-turn census scope across nodes/fallback, actual deterministic planner continuation and calibrated model contracts await parent integration/evaluation. E's scope.reference criterion treats ordinal/deictic/history-only as unsupported meaning/none; synthetic none responses only prove containment after that judgment, not recognition of raw Japanese. No provider activation, real API, flags, deploy, scheduler/save/approval authority, new user collection, GitHub write or commit is included.

Production import audit: parent ORRERY #2460 approves the seven individually documented entries in `semantic/weeklyPlanningStableV5ProductionIsolation.test.ts`. Five application modules consume typed graph/question/session/finalize/diagnostic contracts; the two test-only helpers are additionally protected against any production incoming import by `candidateSelection/dormantArchitecture.test.ts`. No wildcard or test-source predicate expansion was added.
