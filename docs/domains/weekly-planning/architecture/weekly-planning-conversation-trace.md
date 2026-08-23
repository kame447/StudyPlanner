# Weekly Planning Conversation Trace Architecture

Status: supporting trace architecture / schema v2
Updated: 2026-08-23

Parent contract: [current-contract-v5.md](current-contract-v5.md)
Active work: [../work/README.md](../work/README.md)

## Responsibility

Trace is a diagnostic journal. It is not planning domain state and must not decide readiness, scheduling, approval, authorization, billing or security outcomes.

Trace writes are best effort: a trace transport failure must not change the accepted planning result.

## Current storage model

The current trace contract uses schema version 2. A logical user turn is represented primarily by a bounded turn diagnostic rather than the old stage-by-stage chunk stream.

Representative implementation:

- `src/features/weeklyPlanning/trace/weeklyPlanningTurnDiagnosticV2.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTraceTypes.ts`
- `src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.ts`
- `workers/ai-proxy/src/weeklyPlanningTracePrivacy.ts`

Session records provide bounded list/query metadata. Diagnostic entries retain enough evidence to inspect the user contribution, AI semantic request/result, validation/binding decision, final assistant output and relevant failure metadata without cloning the entire runtime state or all external plans into every entry.

## Legacy compatibility

Schema version 1 `turn` / `internal_event` / `state_snapshot` and historical debug-stage data may remain readable for existing records. They are legacy compatibility, not the current write architecture.

Do not reintroduce Base64 stage chunking or large runtime snapshots as the default v2 write format merely to preserve historical shape.

## Identity / recovery

Trace identity is bound to logical conversation / session / request and monotonic sequence information. Retry and reload must converge without creating additional empty sessions for the same logical conversation.

Production recovery verification is tracked by Issue #89 and [20260728-trace-production-recovery.md](../work/20260728-trace-production-recovery.md).

## Privacy / lifecycle

Raw account identity, retention, HMAC subject tokens, restricted access, audit, deletion, TTL and production governance are separate safety responsibilities tracked by Issue #45 and [20260731-trace-privacy-and-lifecycle.md](../work/20260731-trace-privacy-and-lifecycle.md).

Diagnostic value does not override privacy/retention requirements. Client-generated trace is observability evidence, not an authorization source.
