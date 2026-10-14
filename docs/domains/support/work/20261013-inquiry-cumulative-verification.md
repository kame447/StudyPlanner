# Inquiry navigation cumulative verification

Status: exact local integration verified; native browser gates and inquiry publication approval pending
Base: `840e7aeb6dd962fdc51de43cc3ab54818b82b427`
Original inquiry branch/commit retained unchanged: `fix/inquiry-return-navigation` / `d6320450d0a00f10ba8ecee53f53eea9a3b3eedd`
Integration worktree is detached for verification; it is not another feature branch or replacement PR.

## Exact release units

- Inquiry navigation: local tree `ce4563d5bca58664caf5f9f38be7f7addcba2a8f`.
- [Profile recovery #619](https://github.com/kame447/StudyPlanner/pull/619): final tree `da2ce896848756b3894ea0c39a231105d1d4c03b`, published `84d14c8566d0ab6e74d7dce67562186264a8a1c7`, identical local `5355d5e9f55a6626908b32de3f607f84371a5846`. Runtime matches the earlier `b23f14cf`/`9a60afbc` version; its six-line production-logo browser fixture repair and updated checkpoint are included.
- [Theme storage #620](https://github.com/kame447/StudyPlanner/pull/620): corrected tree `0d886d386f2d84b4141f40540de6d9a3b6ddb358`, published `df712f4eed467ead1fe3d4b97a581bb6f32fab55`, identical local `d38e6a08e9f0c47ebbdc18770027249120b0b638`.
- [Admin snapshot #618](https://github.com/kame447/StudyPlanner/pull/618): tree `e2d652e0dfdc6e57cb42fa1d1b11a5a4fca8afc6`, published `f9c740df9e62282581c833581ebe84e4d78f595f`, identical local `1ce13dd463245fc1a6f6e7fef6d2c28a4ca65b88`.

The only textual conflict was the shared cross-browser test selection. Both inquiry and theme specifications remain registered, and the profile recovery matrix entry remains intact. App theme error wiring, public navigation, root profile recovery rendering and bootstrap session fencing are composed unchanged. The later inquiry-owned visibility correction described below is the only additional runtime change after this initial composition. Admin #618 is now on main at `3c19e5560f161249fbc9208669ec08f60b11b9c8`, with the same `e2d652e0` tree as the composed snapshot.

## Composed boundary probes

Added three tests beside the actual-root/profile/SDK boundary suite: direct contact with rejected theme reads or writes never starts planner work early, returns through normal profile recovery, preserves unknown saved theme values, and does not add a second theme owner when revisiting contact. A pending recovery may settle behind contact; a later sign-out revokes its retained retry and all history subscribers are removed on unmount. The sign-out probe aligns the repository's null session with the emitted auth event rather than leaving an impossible signed-in fixture response.

Initial focused checks: 21 files / 363 passed; the additional composed boundary probes passed 50 tests. The first cumulative full verification passed 848 files / 7,905 tests and is archived under `inquiry-cumulative-evidence-20261013/initial-cumulative-verification/`, corresponding to integration commit `0ca29648097fde9ae9f70407002aa0929641bcba` / tree `833aa4466caa8e68cdc31f4f6a1cd8156e6e94fb`.

Independent review then found hidden first-mount geometry after asynchronous readiness and hidden remeasurement on plan changes. Inquiry follow-up commit `89f6f7db` defers only first UI presentation, retains existing planner lifetimes, clears presentation history for changed standalone owners, and pauses/restarts Home's actual measurement effect. Four red-to-green regressions directly cover initial layout, zero geometry, stale callbacks and same-owner logout/login. The final focused suite is 65/65. The profile asset repair is isolated in preceding commit `82d3ea0e`.

Final exact-content `npm run verify` passed on 2026-10-13 12:12 UTC: 849 files / 7,909 tests, fresh app/Worker typechecks and production build. Eleven skipped files / 54 skipped tests / 1 todo are not passes. `verify.log` SHA-256: `c04262d68d0a7f1eeb46a04658bd4ed0366cf3ad3d197499dac663b45b55bedb`. The snapshot records HEAD `82d3ea0e` plus the full then-dirty visibility delta; every tracked/untracked input, generated Worker types, 19,305 installed dependency files, Node/npm/tools and relevant environment matched before/after. The final commit differs from that snapshot only by documentation, recorded separately in the final receipt. A superseded partial verification was deliberately cancelled when the same-owner regression was added; it is not reused as passing evidence.

Browser collection now preserves 52 cases (inquiry 28, theme 16, profile recovery 8) across the existing matrix. Collection is not native execution; this environment cannot run native browsers. Four inherited bundle-budget violations remain, with thresholds unchanged. No remote publication, main update, deployment, Rules, Docker or workflow edit is part of this local integration.

Next: hand the reviewed frozen combined tree and inquiry-only follow-up commit to the parent. Inquiry publication still needs separate approval; native CI must verify the exact authorized remote tree. Original feature branches and worktrees remain unchanged.
