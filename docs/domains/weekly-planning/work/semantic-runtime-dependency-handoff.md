# Stable V5 legacy runtime dependency guard

## Current repository status (2026-10-24)

[PR #811](https://github.com/kame447/StudyPlanner/pull/811) merged into `main` on 2026-10-23 UTC as `398ad1143ad36b742ad9cee076466688e42e44d7`. The merge is present in the inspected main snapshot `382fdff2a5ee98850aea2eb369eeaeee420d636d`.

The checkpoints below retain their original source, verification and authorization limits; their pending publication/merge statements are historical, not the current queue. This status correction claims no new test, device or deployment verification. Paths are retained; archive relocation and invariant transfer are outside this change.

## Preserved implementation and verification checkpoints

Status: active — published as draft PR #811; main plus #845 local integration verified; publication and applicable CI pending

## Scope and ownership

- Original implementation base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9` (historical verification below).
- Existing branch: `refactor/test-invariants-20261020`; [PR #811](https://github.com/kame447/StudyPlanner/pull/811). The broader [#382 audit](https://github.com/kame447/StudyPlanner/issues/382) remains open.
- Existing work reviewed: #569 / merged PR #756 (dependency guard), #382 (test audit), current open PRs and remote branches. This unit extends the existing guard rather than replacing it or duplicating the broader audit.
- Protect the formal turn and approval application entry points against runtime reachability of the old natural-language rules and intake pipeline. Preserve type-only dependencies and dormant legacy code; do not change production behavior, current semantic validation, #305/Jev, or #805 diagnostics.

## Decision and verification plan

Three options were considered: globally prohibit the old rules module (incorrectly captures retained dormant callers), add another independent graph walker (duplicates the existing compiler-based checker), or extend the current checker with explicit live application roots (bounded and reuses tested resolution/elision).

The third option is selected. A production import alone does not prove active semantic authority: inspect complete runtime paths and retain saved-data/type compatibility. A forbidden fixture passing the original guard will establish the detection gap; the corrected guard must reject direct, transitive and supported dynamic imports, while accepting erased type references and non-live legacy roots. Run the actual production graph, related architecture tests, fresh type checks and full verify on final integration content. No runtime violation or bug fix is claimed before that evidence exists.

Initial plan: demonstrate the missing guard with isolated fixture injection, then implement the minimum rule and verify it. The evidence below supersedes this planning checkpoint.

## Historical implementation and focused evidence (2026-10-20)

The existing graph checker now applies `live-legacy-runtime` only to the two formal application roots. It checks the three reviewed legacy execution modules without changing the earlier rules. Root-presence assertions prevent silently losing coverage if a facade is renamed. Direct and bridge-mediated side-effect imports, re-exports and literal dynamic imports are rejected. Erased type references and dormant legacy callers remain allowed.

- Before the rule was added, two controlled bridge imports (one per live facade) produced no violations: the new rejection expectations failed, while all 52 pre-existing cases passed. This establishes a guard gap, not a current production defect.
- Final focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/features/weeklyPlanning/weeklyPlanningDependencyDirection.test.ts src/features/weeklyPlanning/application/weeklyPlanningApprovalApplicationArchitecture.test.ts`.
- Result: 2 files / 62 tests passed. The real production graph has no violations or uninspectable imports. The new finite matrix covers 2 roots × 3 legacy modules × 3 import syntaxes × direct/bridge paths; it is not a general claim about arbitrary JavaScript execution.
- Independent review found no blocker; production, dependencies, runner configuration and existing assertions are unchanged.
- Full verification completed below. No publication or CI result is claimed.


## Historical local verification (2026-10-20)

- Verified implementation commit: `8437e105b503c951b6c48e531d6fa6ed228d91fb`; tree `0cb72676402c1f162c37a0c26873b06b58676333`.
- Command: `DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false npm run verify`, exit 0 on 2026-10-20. Fresh app/Worker typechecks, 1,054 test files / 10,537 tests passed; 12 files / 67 tests skipped and 1 todo remain explicitly non-passing coverage. Production build passed in 15.26 seconds.
- Installed tools: Vitest 3.2.7, Vite 6.4.3, TypeScript 5.9.3, Wrangler 4.151.0. Installed via locked `npm ci --ignore-scripts`; package-lock SHA-256 `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`.
- Complete verification log SHA-256: `be4295a1d12701b6ec15325023964275e92cee9fb577548c357135ef9ef7f49b`.
- Historical commit `070d25cbe14796aebb8168ac5425c93e3506df1c` was fetched before verification for the existing old-worker fixture. The only new untracked files after verification are that generated fixture cache. Tracked implementation tree stayed unchanged.
- Independent review: no blocking findings. Final root-presence and direct-path fixture additions passed the focused and full runs. This final checkpoint update is documentation-only and does not invalidate the verified runtime/test content.
- At that local checkpoint, publication and remote CI/integration were pending. The subsequent publication and current remaining work are recorded below. This guard catches future prohibited runtime edges, not arbitrary semantic interpretation errors or current product bugs.


## Current integration checkpoint (2026-10-23)

- Published PR head: `653d784d4719e5dc3d65a11b3d589d00db86f589`, including its prior main integration at `82a948ae6dd9f39d6a445d3408b8b8d3ae2664a3`.
- Exact-head CI / verify, Chromium Browser Regression, Admin render, UI Quality and Pages succeeded. [UI Regression Matrix](https://github.com/kame447/StudyPlanner/actions/runs/39850270964) was cancelled and its aggregate failed; the agentic local-harness check was also cancelled. Cancelled checks are missing evidence, not passes. The older failures in the PR discussion remain historical evidence, not results for this head.
- Local integration candidate combines that unchanged test implementation with fetched main `2ea267f4`; the merge has no conflicts. Only this handoff is corrected beyond the existing PR diff. No production behavior, test assertions, dependencies, timeouts or acceptance criteria are changed by this unit.
- Focused integration proof: `DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false npm run test:run -- src/features/weeklyPlanning/weeklyPlanningDependencyDirection.test.ts src/features/weeklyPlanning/application/weeklyPlanningApprovalApplicationArchitecture.test.ts`, exit 0: 2 files / 62 tests passed, including the actual production graph. Content before this documentation-only checkpoint: merge tree `ad1420aa1542fe021cb38330e8c0f22f7e1e3e87`. Node 22.23.4, Vitest 3.2.7, Vite 6.4.4, TypeScript 5.9.3, Wrangler 4.151.0; all 242 installed locked packages matched, with no missing required packages. Lockfile SHA-256: `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`. The focused run preceded the full verification below; no browser run was repeated by this worker.
- Serialized full verification: `DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false npm run verify`, exit 0 on exact staged tree `926ab78162bdee6f770445c589b2b4077d8db039` (HEAD `653d784d` plus the main merge and documentation correction), Node 22.23.4. Fresh app/Worker typechecks passed; 1,067 files / 11,208 tests passed, with 12 files / 67 tests skipped and 1 todo; production build passed in 15.74 seconds. Log SHA-256: `c1f06f700d52b311a1c957d39a077242991d133b7543ece46559d44e1c5ee323`.
- After verification, the staged tree and tracked working files were unchanged, and all 242 installed locked packages still matched with no missing required packages. The generated old-worker fixture cache was the only untracked input addition. This subsequent checkpoint update changes only Markdown and does not change the verified implementation content.
- Next: update this same branch only when authorized and inspect exact-head applicable CI before any merge decision. Local full verification does not replace browser/visual/Firestore CI gates. No main update, new PR or branch deletion is part of this checkpoint.


### Verified #845 integration

The local candidate also integrates published #845 head `b9629718d1dfcdab02d842bd98534cbc2a491c93` without conflicts. The #811 guard test remains byte-identical to its published head. The earlier full verification predates this integration; the new combined-content proof is:

- Same full command and Node 22.23.4, exit 0 on tree `3c7d846d9c228953b97dfa6c56a91f7e6e7405a3` (local HEAD `61713146` plus the staged #845 merge and documentation checkpoint).
- Fresh app/Worker typechecks passed; 1,069 files / 11,210 tests passed; 12 files / 67 tests skipped and 1 todo; production build passed in 14.37 seconds.
- Log SHA-256: `516fb8a5f0710650896b5ce66058ff1c1f1baf7d9a521ab70062ed2468067755`. Staged tree and tracked working files were unchanged after execution; all 242 installed locked packages still matched, with no missing required packages. This final evidence update is Markdown-only.
- Publication waits for #845 to land on main and the integration owner to release this branch. Required exact-head CI/browser gates and any merge decision remain pending.

### Native Admin harness repair

Published head `048ec56112e61430ca54a300aebeb923fed8c36f` has the reviewed tree above and actual main `ae833f7a` as its integration parent. Its [Admin run](https://github.com/kame447/StudyPlanner/actions/runs/39971045108) passed 68 cases but failed the announcement-owner case before its behavior assertions: the poll read `.length` from an uninitialized service-stub global. The service loads through a dynamic import, so a visible bell alone is not a readiness guarantee.

The bounded repair changes only that poll to `window.__announcementReads?.length`. Its exact expected count of one, timeout, retry and owner/history assertions remain unchanged. Undefined remains a nonpassing poll result. Non-browser controls using the installed Playwright `expect.poll` verified delayed initialization succeeds only at one, while never-initialized, zero and two calls fail. Local Chromium launch was blocked before case execution; these controls do not establish browser acceptance.

Full `npm run verify` with the same Node/environment passed on tree `137a1a8dd54edf7f45db00874c96c8089e9d9b4e`: fresh app/Worker types, 1,069 files / 11,210 tests passed, 67 skipped / 1 todo, build 15.12 seconds. Tracked content and all 242 installed locked versions remained unchanged; a byte-level dependency digest before that full run was not recorded. Log SHA-256: `76e992b9b1f8111a4477e29b2baf5132437fd1c51a2c24378e3a07869476a3ce`. This evidence update is Markdown-only. Exact successor-head native Admin and other applicable CI remain required before merge.
