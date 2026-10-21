# Occurrence day boundary

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
