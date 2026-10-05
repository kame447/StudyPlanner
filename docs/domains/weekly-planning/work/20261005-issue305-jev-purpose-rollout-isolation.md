# Issue #305 — Jev purpose rollout isolation

Status: implementation locally verified; review pending; rollout remains off; no deploy/PR merge
Owner: JollyYukawa; review: BronzeMaxwell / CopperHopper
Branch: `feat/issue305-jev-purpose-rollout`
Base/HEAD: `87daed8904b656b8393745ea4ca5dec4f4273e8b` (`origin/main` at final integration)
Initial base: `dc4093c28e242fde02cf8da63323701a53154e06`; #462 advanced main with no overlapping files; local base fast-forwarded before final verification.
Worktree: `/Users/Shogo/.agentstack/worktrees/JollyYukawa-jev-purpose-rollout`
PR: none; existing Issue #305 reused. No existing branch/PR owns this scope.

## Responsibility and design decision

This change isolates deployment selection only. It does not alter decision
catalogs, confidence gates, eligibility, provider inputs, telemetry fields,
whole-utterance fallback, scheduler, approval or save.

Compared before implementation:

1. Explicit mode/percentage per known purpose: no inheritance on omission,
   independently testable, bounded configuration surface. Chosen.
2. A single JSON allowlist/map: smaller binding count but ambiguous partial
   parsing/unknown keys and a larger operator editing failure surface.
3. Separate Worker releases per purpose: isolates traffic but duplicates existing
   auth/quota/fallback infrastructure and enlarges the release unit unnecessarily.

The first option is wrong if any dispatch bypasses its purpose policy, global
off fails to suppress a configured route, shadow can return Jev authority,
unknown purposes inherit an enabled purpose, or retry selection is unstable.
These are explicit regression targets; passing mocks is not adoption evidence.

## Configuration contract

- `JEV_MODE=off`, absent or malformed: emergency off for every purpose.
- Global `shadow`: enabled purposes can only shadow, never return Jev authority.
- Global `canary`: each purpose may independently be off/shadow/canary.
- Every known purpose requires its own exact mode and percentage strings;
  omitted/malformed settings fail closed. No global mode/percentage inheritance.
- Purpose percentage strings are exactly `0`, `5`, `25`, `100`. Canary with `0`
  is off. Shadow is background-only and needs Worker lifecycle as before.
- `JEV_CANARY_PERCENT` remains a strict global canary ceiling, with the same
  exact strings. Missing/malformed values close all routes; global canary `0`
  closes all routes. Effective canary percentage is the minimum of global and
  purpose percentages. These percentages bound authoritative canary cohorts,
  not shadow send rate: valid shadow `0` may still send Jev for every eligible
  request. Global shadow with `0` remains background-only.
  Use `JEV_MODE=off` for the global emergency switch.
- Known purposes: focused authorization (#337), focused contextual answer (#338),
  temporal scope repair (#340), user-context routing (#339), candidate Choice.
  Each has `JEV_<PURPOSE>_MODE=off` and `JEV_<PURPOSE>_CANARY_PERCENT=0` defaults.
  Unknown/new purposes are off until explicitly added in reviewed code/config.
- Canary cohorts use a fixed hash of purpose plus authenticated Firebase UID,
  in memory only. No text hashing, new identifiers or telemetry fields. Increasing
  5→25→100 retains previous cohorts; changing another purpose does not resample.
  These are user cohorts, not exact percentages of requests or independent random
  samples. Small populations need not match the nominal percentage.

For a separately approved configuration, #337 at 5% and #340 at 25% would use
`JEV_MODE=canary`, `JEV_CANARY_PERCENT=100`,
`JEV_FOCUSED_AUTHORIZATION_MODE=canary`,
`JEV_FOCUSED_AUTHORIZATION_CANARY_PERCENT=5`,
`JEV_TEMPORAL_SCOPE_REPAIR_MODE=canary`, and
`JEV_TEMPORAL_SCOPE_REPAIR_CANARY_PERCENT=25`. All other purpose bindings remain
off/0, including candidate Choice. This is an operator example, not activation
authorization. No existing evaluation HOLD/BLOCK or unadopted route is changed.

Stop one purpose with its mode `off`; other cohorts/settings remain stable.
Stop everything with `JEV_MODE=off`. In global `shadow`, even purpose `canary`
uses Luna authority; candidate Choice still returns unavailable without a live
shadow send. Apply config through the existing reviewed release workflow only;
this implementation makes no deployment or secret change.

Legacy opt-in evaluation runners/fixtures now explicitly configure only their
own purpose. Without this adaptation a treatment could silently become baseline
after fail-closed isolation. The synthetic/mock tests run offline; remote runners
are not executed, new research routes are not added, and old holdouts are not
independent adoption evidence.

Observation uses the effective purpose mode. A background Jev send does not
make the authoritative Luna send a fallback. The existing summary stage counts
are Luna-only; raw Jev/Luna recorder entries independently prove both stages.
No telemetry schema or collection boundary changes.

## Checkpoint and completion criteria

Current: implementation complete; 44 focused files / 775 tests passed after
mixed-mode repair and percentage ceiling; Node 22.23.0 typecheck passed on the
final integration base. Catalog/gate declarations are unchanged. Final `npm run verify` passed: fresh app/Worker typechecks, 706 test files
(5390 tests) passed, 10 files/45 tests skipped and 1 todo as configured; production
build passed. This is local integration evidence, not live API or deployment
evidence. Next: parent/external audit of exact tree/diff, then parent publication
and CI when authorized. Focused command/result and dependency identity are recorded under
`/Users/Shogo/.agentstack/runtime/jev-impl-reports/r2/jev-purpose-rollout-evidence/`.

Earlier verification failures were classified and resolved: nine census mocks
lacked explicit purpose configuration; four new observation assertions mistakenly
counted Jev in the Luna-only summary. Existing assertions were retained. The
independent audit reproduced and then passed the mixed-mode observation repair;
that probe is narrower than a formal final-content audit.

Done: safe off config, unchanged gate/catalog fingerprints, green focused tests,
typecheck/build/full verify, exact HEAD/tree/diff and installed-dependency evidence,
PR-ready local branch/report delivered to both reviewers. Review is pending;
parent must decide publication and any later activation separately. Merge, deploy, provider
execution and a claim that historical or current adoption gates passed are excluded.
