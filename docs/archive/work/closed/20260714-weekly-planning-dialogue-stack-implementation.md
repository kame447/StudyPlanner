# weeklyPlanning dialogue stack implementation

Status: **implemented modules / verification pending**
Date: 2026-07-14
Original branch: `feat/weekly-planning-dialogue-stack-completion`
Current branch containing the modules: `main`

## Consolidated tasks

- DA1b assumption decision and correction contract
- Draft approval idempotency
- DA2 state-grounded dialogue orchestrator
- DA3a relative constraint domain
- DA3b feasibility consultation
- DA3c conversation evaluation

## Implemented modules and contracts

### DA1b

- typed assumption accept / reject / modify commands
- closed validation against current conversation、revision、pending status
- immutable proposal history with accepted / rejected / superseded / expired
- `resolvedBy` audit references
- independent correction envelopes
- deterministic correction ordering
- correction-triggered proposal resolution and preview invalidation
- canonical `assistant_suggested` transition
- preview authorization command type integrated into the common command union
- lifecycle-aware interpreter decorator
- session-local proposal ledger carried through `PlanningIntakeState`

### Approval

- save-boundary preview metadata validation
- stale preview and pending-assumption preview rejection as separate categories
- accepted-assumption dependency revalidation
- legacy exam preview compatibility
- deterministic item ledger
- `userId + sourceDraftBlockId` duplicate detection
- partial save / retry handling
- versioned and bounded local ledger serialization
- actual `App.tsx` approval path connection
- saved-plan source markers for crash/retry duplicate suppression

### DA2

- dialogue request phase state machine
- conversation / turn / request / revision envelope
- stale async result categorization
- opening and normal call budgets
- cancel / reset / unmount invalidation contract
- pipeline orchestration wrapper
- IME-safe multiline keyboard policy
- Ctrl/Meta+Enter submit decision
- focus restore policy
- logical Tab order contract
- retry with a new request/turn identity

DA2についてはmoduleとcontractの実装を記録する。実際の週間計画UI entrypointがこれらを利用しているかは、本記録だけでは接続済みと判定しない。`20260714-weekly-planning-dialogue-stack-verification.md`で静的接続とbrowser behaviorを確認する。

### DA3a

- typed relative constraints and anchors
- public/current/unique anchor validation
- stale/private/ambiguous/cyclic reference rejection
- deterministic before / after / buffer resolution
- out-of-day rejection
- overlap diagnostics
- explicit relative-language adapter
- hardened behavior bridge connection

### DA3b

- deterministic feasibility classification
- required / available / scheduled / unscheduled minute conservation
- bottleneck and conflict refs
- deterministic prioritize / split / defer option IDs
- finite feasibility dialogue actions
- behavior pipeline connection

### DA3c

- canonical Requirement ID matrix
- duplicate / missing / unknown ID validation
- strict contract and mentor rubric separation
- redacted replay helper
- pass/fail、fallback、stale、preview、duplicate、retry、latency metrics
- fixed-seed bounded property tests

## Added test layers

- assumption lifecycle unit and integration tests
- lifecycle-aware interpreter tests
- approval guard / ledger / compatibility tests
- request orchestrator and UI policy tests
- relative constraint domain and adapter tests
- feasibility tests
- conversation evaluation tests
- dialogue-stack integration tests
- fixed-seed property tests

## Safety boundaries retained

- AI does not apply state、scheduler、save mutations directly.
- Assumption and correction outputs are validated before deterministic application.
- Preview remains unsaved until explicit UI approval.
- Stale and pending-assumption approvals do not start repository writes.
- Existing plans、timetable、buffers、hard constraints remain authoritative.
- Relative constraints do not fabricate availability.
- Evaluation fixtures redact private prompt and credential-like data.

## Verification status

GitHub-side static review of the implementation branch was completed. The modules are now present on`main`。

次は別々に判定する。

```text
module implemented
automated verification passed
production connected
browser verified
```

本記録はmodule implementationのcompletion recordであり、DA2のproduction entrypoint connectionやbrowser verificationを保証しない。検証結果はrootのverification taskで更新し、失敗修正は別taskへ分離する。
