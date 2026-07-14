# weeklyPlanning dialogue stack implementation

Status: **implemented / local verification pending**
Date: 2026-07-14
Branch: `feat/weekly-planning-dialogue-stack-completion`
Parent branch: `feat/weekly-planning-behavior-aware-dialogue`

## Consolidated tasks

- DA1b assumption decision and correction contract
- Draft approval idempotency
- DA2 state-grounded dialogue orchestrator
- DA3a relative constraint domain
- DA3b feasibility consultation
- DA3c conversation evaluation

## Implemented production contracts

### DA1b

- typed assumption accept / reject / modify commands
- closed validation against current conversation, revision and pending status
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
- pass/fail, fallback, stale, preview, duplicate, retry and latency metrics
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

- AI does not apply state, scheduler or save mutations directly.
- Assumption and correction outputs are validated before deterministic application.
- Preview remains unsaved until explicit UI approval.
- Stale and pending-assumption approvals do not start repository writes.
- Existing plans, timetable, buffers and hard constraints remain authoritative.
- Relative constraints do not fabricate availability.
- Evaluation fixtures redact private prompt and credential-like data.

## Verification status

GitHub-side static review is complete. Local execution has not yet been performed for this stack. The root queue contains one verification-only task. Do not mark this record fully verified until targeted tests, TypeScript, build, full tests and manual/browser checks pass.
