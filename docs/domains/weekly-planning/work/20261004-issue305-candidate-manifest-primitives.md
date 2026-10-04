# Issue #305 Unit 2 — candidate manifest primitives

Status: active / dormant foundation, awaiting integration review
Owner: HumbleOstwald (integration: BronzeMaxwell)
Branch: `feat/issue305-candidate-manifest-primitives`
Base / current HEAD: `5668fbfb7337b0f34bbae0ce9016765f12b60439`
PR: none; parent owns GitHub writes and commit/push.

Parent decision: [Phase B acceptance contract](20261004-issue305-jev-hierarchical-input-interpretation.md).

## Scope and exit criteria

Application-owned immutable complete tuples and binding context, canonical serialization/hash, mechanical hierarchy, explicit calibrated probability policy, whole-utterance fallback, three-stage freshness, and atomic commit/consumption contract. No production wiring or rollout changes; no real API/evaluation/telemetry. Tests prove containment, never language accuracy or Luna reduction.

Exit: focused/property/architecture tests, `npm run typecheck`, final `npm run verify`, exact content identity, self-audit against Unit 2 probes, runtime report and ORRERY Mail handoff. Integration review, external audit and CI/merge remain parent responsibilities.

## Checkpoint

- Read root/feature AGENTS, Phase B design, current V5 contract, test philosophy and audit probes.
- Reused Issue #305; inspected latest checkpoint, open/closed task PRs and remote/local branches. No existing Unit 2 implementation. Parent separately assigns Units 0/1.
- Reserved only new `application/candidateSelection/**` and this work record. No existing lifecycle file changes.
- Branch rename encountered sandbox Git metadata denial; parent independently completed rename. Parent instruction: leave final content uncommitted, report status and diff/content SHA-256.
- Implemented immutable manifest, exact basis freshness, hierarchy, calibrated gates, staging and commit-port contract. Added property tests and executable in-memory reference transaction. Focused feedback found an accessor response validation defect; fixed by strict JSON snapshot before probability gating. Typecheck found missing runtime number guards and a deliberately malformed test cast; fixed without changing assertions.
- Dependencies: initial typecheck could not find `tsc` because this fresh worktree had no dependencies. Offline install could not obtain Wrangler; installed lockfile dependencies with `npm ci --ignore-scripts --cache /private/tmp/unit2-npm-cache`. No lockfile or runtime config changes.
- Focused/property/import-boundary tests: 87 passed (3 files). Typecheck initially passed; a later deliberately mutable parameter regression needed a mutable test-policy fixture type, corrected without weakening its assertions.
- Final verification results, exact uncommitted-content identity, installed environment and probe-by-probe audit will be recorded in `/Users/Shogo/.agentstack/runtime/jev-impl-reports/unit2-manifest.md` (avoids self-referential document hashes). The final content remains uncommitted for parent review.
- Next / remaining: final `npm run verify` passed on the submitted content (exit 0); parent review done; CopperHopper exact-diff audit, then PR CI and merge. Unit 2 cannot grant route adoption; calibration and consuming PoC integration are separate work.

## Atomicity investigation

Stable V5 formal graph work is staged before controller commit. `submitWeeklyPlanningControlledTurn` awaits execution, checks pending identity, synchronously prepares graph commit, rechecks identity, then dispatches `commit_turn`. A rejected reducer commit rolls the prepared graph back. The reducer accepts only the current pending turn and expected revision. Question presentation binding (#348) is established as part of that accepted commit; a new message/revision invalidates the old question. This is local client state, not cross-device compare-and-swap.

The new primitive must not claim that an earlier freshness check authorizes later mutation. Consumers must re-read source access/state, current intent, complete candidate basis, question presentation and selection ledger **inside the same atomic transaction** that validates/applies the leaf and records consumption. The callback must be synchronous; any awaited persistence must supply its own authoritative transaction/CAS and retry the callback on conflicts. Existing controller/reducer/runtime-session code is investigated only, not modified by this unit.

The existing `canCommitTurn` checks pending identity, week and revision only. It does not validate source permissions, candidate basis, or a selection ledger. Unit 3 must add actual #270/#348/controller/reducer integration and durable-consumption tests, including rollback when `commit_turn` rejects. Units 3–5 stay HOLD if their consumer cannot meet this boundary.

Unhandled commit-port exceptions return `unknown`: an exception may occur after the atomic effect. This is neither proof of rollback nor permission to replay another mutation/Luna fallback. The consumer must recover its authoritative ledger/outcome. `failed` may be returned by a port only when it positively knows no effect occurred. Tests exercise before-callback, callback boundary, validator, pre-write and post-commit failures, including a commit-then-throw retry that is consumed exactly once.

Provider adapters must invoke `beforeDispatch` after async auth/preparation and immediately before exposure, without an intervening await. The staging driver also checks before adapter entry and after each response. An adapter using asynchronous/remote access authority must revalidate that authority at dispatch; the synchronous observation callback is not an asynchronous permission service. Hashing occurs only after a deep snapshot, before routing; a hash never authorizes exposure.

Provider context is an immutable application projection of question ID/code, target and semantic scope from binding. It excludes owner, conversation and permission/source metadata, and is shared across all hierarchy levels and flat comparisons. Consumers own privacy eligibility of their tuples and semantic scope, and must prove their eventual actual provider wire carries the minimum context; this unit's serialization test covers only the dormant request port. Validated current-turn intent provenance is a formal prerequisite, not proof that an utterance contains no independent meaning. Semantic sufficiency remains an empirical model judgment.

## Limitations and trace exclusion

Process-local manifest/selection branding is a construction guard, not durable identity or authority. Local revisions are not cross-device CAS. The foundation does not persist or hydrate selections/ledger, read remote source authorities, or supply a production atomic adapter. Consumers must preserve consumption across retries/reload and recover unknown outcomes. The executable reference port verifies its contract only; it does not prove production integration.

No production prompt, request/response, diagnostic/trace or saved-state schema changes. Manifest, scope and raw utterance are intentionally excluded from production trace to avoid duplicating sensitive source/intent data. No alternative diagnostic collector is added. Import-boundary tests enforce that neither trace nor production runtime/provider/storage can reach the foundation. Any future wiring changes this premise and must satisfy feature AGENTS trace-persistence and privacy gates.

## Alternatives examined

1. Labels/IDs plus a short hash: simple and familiar, but tuple/context changes and collisions can be missed. Falsified by same-label/different-ID or scope changes; small implementation, unsafe binding. Rejected.
2. Full immutable canonical basis and SHA-256 plus independent formal gates: detects all JSON tuple/context changes and preserves order. Falsified if a consumer omits semantic tuple fields or returns stale observations; tests cover serialization and binding, consumer contract covers completeness. Chosen, limited to dormant modules.
3. Mutating each parent route or calling an awaited apply after a pure check: superficially cheaper, but hierarchy failures leave partial state and checks can race. Falsified by revocation/none after an intermediate route; large lifecycle impact. Rejected.
4. Pure staged leaf plus a consumer-owned atomic port: source checks at each exposure/response, final check and ledger in the commit callback. Falsified by an adapter doing an awaited write without transaction/CAS. Chosen with explicit typed/documented obligations; no claim that the port itself implements cross-device atomicity.
