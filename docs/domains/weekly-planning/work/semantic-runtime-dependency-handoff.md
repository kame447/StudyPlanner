# Stable V5 legacy runtime dependency guard

Status: locally verified implementation, not published

## Scope and ownership

- Base: `22e42203a4df82b5432d4290b7b5ea3a4246b8c9`.
- Branch: `refactor/test-invariants-20261020`; no PR created.
- Existing work reviewed: #569 / merged PR #756 (dependency guard), #382 (test audit), current open PRs and remote branches. This unit extends the existing guard rather than replacing it or duplicating the broader audit.
- Protect the formal turn and approval application entry points against runtime reachability of the old natural-language rules and intake pipeline. Preserve type-only dependencies and dormant legacy code; do not change production behavior, current semantic validation, #305/Jev, or #805 diagnostics.

## Decision and verification plan

Three options were considered: globally prohibit the old rules module (incorrectly captures retained dormant callers), add another independent graph walker (duplicates the existing compiler-based checker), or extend the current checker with explicit live application roots (bounded and reuses tested resolution/elision).

The third option is selected. A production import alone does not prove active semantic authority: inspect complete runtime paths and retain saved-data/type compatibility. A forbidden fixture passing the original guard will establish the detection gap; the corrected guard must reject direct, transitive and supported dynamic imports, while accepting erased type references and non-live legacy roots. Run the actual production graph, related architecture tests, fresh type checks and full verify on final integration content. No runtime violation or bug fix is claimed before that evidence exists.

Initial plan: demonstrate the missing guard with isolated fixture injection, then implement the minimum rule and verify it. The evidence below supersedes this planning checkpoint.

## Implementation and focused evidence

The existing graph checker now applies `live-legacy-runtime` only to the two formal application roots. It checks the three reviewed legacy execution modules without changing the earlier rules. Root-presence assertions prevent silently losing coverage if a facade is renamed. Direct and bridge-mediated side-effect imports, re-exports and literal dynamic imports are rejected. Erased type references and dormant legacy callers remain allowed.

- Before the rule was added, two controlled bridge imports (one per live facade) produced no violations: the new rejection expectations failed, while all 52 pre-existing cases passed. This establishes a guard gap, not a current production defect.
- Final focused command: `DEV_LAN_HOST=127.0.0.1 npm run test:run -- src/features/weeklyPlanning/weeklyPlanningDependencyDirection.test.ts src/features/weeklyPlanning/application/weeklyPlanningApprovalApplicationArchitecture.test.ts`.
- Result: 2 files / 62 tests passed. The real production graph has no violations or uninspectable imports. The new finite matrix covers 2 roots × 3 legacy modules × 3 import syntaxes × direct/bridge paths; it is not a general claim about arbitrary JavaScript execution.
- Independent review found no blocker; production, dependencies, runner configuration and existing assertions are unchanged.
- Full verification completed below. No publication or CI result is claimed.


## Final local verification

- Verified implementation commit: `8437e105b503c951b6c48e531d6fa6ed228d91fb`; tree `0cb72676402c1f162c37a0c26873b06b58676333`.
- Command: `DEV_LAN_HOST=127.0.0.1 WRANGLER_SEND_METRICS=false npm run verify`, exit 0 on 2026-10-20. Fresh app/Worker typechecks, 1,054 test files / 10,537 tests passed; 12 files / 67 tests skipped and 1 todo remain explicitly non-passing coverage. Production build passed in 15.26 seconds.
- Installed tools: Vitest 3.2.7, Vite 6.4.3, TypeScript 5.9.3, Wrangler 4.151.0. Installed via locked `npm ci --ignore-scripts`; package-lock SHA-256 `ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693`.
- Complete verification log SHA-256: `be4295a1d12701b6ec15325023964275e92cee9fb577548c357135ef9ef7f49b`.
- Historical commit `070d25cbe14796aebb8168ac5425c93e3506df1c` was fetched before verification for the existing old-worker fixture. The only new untracked files after verification are that generated fixture cache. Tracked implementation tree stayed unchanged.
- Independent review: no blocking findings. Final root-presence and direct-path fixture additions passed the focused and full runs. This final checkpoint update is documentation-only and does not invalidate the verified runtime/test content.
- Remaining: publication and any remote CI/integration checks require the parent workflow; no main edits, push or merge performed. This guard catches future prohibited runtime edges, not arbitrary semantic interpretation errors or current product bugs. No branch deletion is required while this local candidate remains under review.
