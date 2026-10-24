# Occurrence day boundary

## Current repository status (2026-10-24)

[PR #819](https://github.com/kame447/StudyPlanner/pull/819) merged into `main` on 2026-10-23 UTC as `aaac18833d2565d23bd7d5e68ffe0c962887c91b`. The merge is present in the inspected main snapshot `382fdff2a5ee98850aea2eb369eeaeee420d636d`.

The checkpoints below retain their original source, verification and authorization limits; their pending publication/merge statements are historical, not the current queue. This status correction claims no new test, device or deployment verification. Paths are retained; archive relocation and invariant transfer are outside this change.

## Preserved implementation and verification checkpoints

Status: active, local implementation; publication not authorized.
Updated: 2026-10-20 UTC.

Branch: refactor/calendar-domain-boundaries-20261021. Base: 22e42203a4df82b5432d4290b7b5ea3a4246b8c9.

Current main, AGENTS.md, scheduling authority contract, open PRs 808–816 and calendar branches were inspected. No overlapping active calendar implementation was found. #356/#360 and #278 are completed history, not revived owners. #442 records recurring series versus selected occurrence navigation; #776 records an unresolved WebKit overnight save/reload flake. Neither is claimed fixed here. Historical deletion/undo regression tests remain unchanged.

Three candidates were compared: extracting editor draft selection (small but mostly file movement); moving recurring persistence transitions (already domain-owned, risk to accepted revisions); consolidating occurrence day overlap/clipping (selected). Canonical occurrence projection already owns half-open interval semantics, but week layout owns duplicate day overlap and DayView duplicates clipping. This is falsified if projection and clipping differ on existing normalized occurrences; characterization must pass before/after. Scope removes semantic duplication without changing persistence, recurrence, identity, async ownership or visual layout.

Reserved: domain/scheduleOccurrence.ts and day boundary tests, lib/weekViewLayout.ts/tests, imports in lib/scheduleItemActions.ts and components/WeekView.tsx, DayView imports and inline day clipping only. PR815 radial changes must remain untouched.

Seven audit perspectives: architecture (domain owner), persistence (no writes/schema changes), state transitions (no mutations), async (no callbacks changed), date (midnight, leap/DST/year boundaries), UI/input (imports and pure day projection only), regression tests (existing plus domain characterization). Next: baseline tests, deduplication, targeted tests in UTC and New York, independent reviews, parent-coordinated full verify. Exit: exact diff reviewed and all required checks pass; native browser remains separately verified.

## Verification checkpoint

- Initial baseline: 3 files / 47 tests pass before production edits. Existing nine day-boundary characterization cases were moved unchanged to the domain test.
- Initial focused UTC suite: 8 files / 100 tests pass, including final-date deletion and real local read, recurring lifetime and month-event Undo regressions.
- America/New_York domain + Day/Week/Month suite: 5 files / 50 tests pass. Two new canonical recurring tests preserve explicit later 00:00 versus 24:00 endpoints, source identity and exclusions.
- Two independent reviewers found no blocker across all seven perspectives for the initial diff.
- Initial snapshot tree b37611d93ebbef9e91728aa84302b709a630b425 passed npm run verify: fresh app and Worker types, 1055 files / 10530 tests passed, 12 files / 67 tests skipped, 1 todo, production build passed. This result does not certify the subsequent extension.
- Exact current-main lock SHA256: ea546daa78b887f737da4cfb1884b8f14f7b39ce4baa639e7baa04d5bfb6c693. npm ci succeeded with a writable /tmp cache; installed hidden-lock SHA256: 8723ba5cfaf3e7aee4f8490dc7bb2edd56aedda4035944664531204a5d03b000. No dependency changes.
- Verification environment: TZ=UTC, DEV_LAN_HOST=127.0.0.1, DO_NOT_TRACK=1, WRANGLER_SEND_METRICS=false, WRANGLER_SEND_ERROR_REPORTS=false, WRANGLER_HIDE_BANNER=true, WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true, CLOUDFLARE_CF_FETCH_ENABLED=false, task-local WRANGLER_LOG_PATH. Normal sandbox; no optional-network bypass.

The same responsibility also remained duplicated in homeScheduleAugmentation and MonthDaySheet. Scope was extended to those callers without changing UI labels, legacy fallback, source identity or study-progress policy. Five new MonthDaySheet tests pass against the old code before the substitutions (2 files / 17 tests). After substitution, New York targeted tests pass (3 files / 28 tests). Independent extension review and a fresh final full verification are pending; initial full-suite evidence is not reused as final proof. No GitHub writes, merge or deployment performed. Native browser behavior is not yet verified.

Both independent reviewers also approved the extended source diff, including unchanged Home IDs/category/owner and MonthDaySheet labels/edit target. Local native-browser capability was retested in the current environment with system Chromium and Python Playwright: Chromium terminated before page creation with process_singleton_posix.cc socket() Operation not permitted and SIGABRT. No bypass attempted. This is an execution-environment blocker, not a passing browser regression or a product assertion failure; repository browser CI remains required after authorized publication.

## Final local verification

Exact implementation commit 8cdbc8ae6cff5f604dd52d667c37074128ebb52f, tree a80639a1b0d7282918df4451a2bbb6f953868a05, passed fresh npm run verify with the environment above: application and Worker typechecks; 1055 test files / 10535 tests passed, 12 files / 67 tests skipped, 1 todo; production build passed in 12.56 seconds with the existing chunk-size warning. Tracked content and lock/installed-lock identities were unchanged after execution. Both independent source reviews include the final Home/MonthDaySheet extension. This evidence checkpoint is documentation-only and does not change tested implementation files.

Local implementation is verified; publication, repository-native browser CI, and integration remain pending parent authorization/coordination. Local Chromium failed before execution due to socket restrictions, as recorded above. No claim that #776 or unrelated historical bugs were repaired. The mixed-owner DayView map suspicion was not established as a reachable defect: current repository getters filter by owner; no speculative behavior change was made. Next action: parent decides publication and integration, then browser CI on the exact authorized head; do not merge without approval.

## Integration checkpoint — 2026-10-23

Existing PR #819 and branch `refactor/calendar-domain-boundaries-20261021` are resumed under the user's merge authorization. Remote head `274f185ddb9d0a518dc37e5279658c045d845088` is integrated normally with main `a0a09f73ab374bbd9c7e160931b615faa5c68520`; no new PR or replacement branch. Open PRs and review threads were checked; there are no review threads or separate owners of this boundary extraction. Original production behavior and tests are preserved. WeekView's current-main changes merge cleanly with the import-only change.

The shared domain overlap implementation is byte-equivalent in comparison semantics to the removed consumer formulas; clipping remains pure, admission remains half-open, and source identity, recurrence, persistence, and labels are unchanged. Alternatives were preserving duplicate helpers (leaves drift), rewriting normalization (unnecessary scope/risk), or retaining this extraction (selected, directly characterized).

Focused integration evidence: UTC 9 files / 81 tests passed; America/New_York 5 files / 47 tests passed, including DST, leap/year/month boundaries, midnight exclusion, recurring identity, Home and MonthDaySheet behavior. Initial Vite startup without DEV_LAN_HOST failed before tests at uv_interface_addresses; the documented DEV_LAN_HOST=127.0.0.1 environment resolves configuration without product changes.

Node v22.23.4; package-lock SHA256 `01cc6c380a2797653d6e9a9dca8e5afe835a2278cb990d21dc6b220ca8aa466f`; installed hidden-lock SHA256 `e39a9cc4979b9c10b158be8d619db1c52645b8844b74016152d4514ff6241997`. Installed packages checked with npm ls; shared installation matches the lock and is not modified here.

Historical head 274f185d had a cancelled Browser Regression and a mobile appearance-theme color assertion flake at tests/e2e/appearance-theme.spec.mjs:118. These are not passing evidence and are not claimed fixed. Next: exact-content full verification, normal existing-branch publication, new exact-head native gates, serialized merge approval from coordinator, and post-merge read-back. No test assertions or timeouts are weakened.

Integrated commit `514e4349daa43d2350c3938d8dfc0ea49ac1b79b`, tree `d2107d358b4dce5bb3cea62f30161f2b44c3f9b3`, passed `npm run verify` with exit 0: fresh app and regenerated Worker types; 1,074 test files / 11,268 tests passed, 12 files / 67 tests skipped and 1 todo; production build 15.30 seconds. UTC and the documented local environment were used. All 242 installed package manifests matched their lock versions, and tracked content plus lock/installed-lock hashes stayed unchanged afterward; only generated `.cache/` appeared untracked. An independent coordinator review found no source blocker on this exact diff. This receipt is documentation-only; native current-head gates remain pending.
