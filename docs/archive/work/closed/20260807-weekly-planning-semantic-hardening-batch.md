# 2026-08-07 Stable V5 semantic / eval hardening batch

Status: closed / implemented in current main
Completed: before 2026-08-22

Eight stale root task documents were consolidated into this completion record. Their detailed investigation history remains in Git history.

## Implemented contracts

- current-turn SemanticDocument is a delta, not an accepted-state snapshot
- top-level component may not use containing task localId as component parent; narrow structural normalization exists
- goal/event date is distinct from a work completion deadline
- entity-local durable concern signals are typed and staged safely
- cross-turn task/component continuation uses explicit `existingPublicId` binding rather than duplicate entities
- structured per-occurrence recurrence consistency is enforced
- copied durable concern does not steal current-turn provenance
- resumable real-API evaluation preserves the last good checkpoint on failure and writes diagnostics before failing
- resumable real-API turns use an explicit bounded timeout rather than Vitest's unit-test default

## Current evidence

Representative current-main implementation / regression surfaces include:

- `weeklyPlanningSemanticNormalizerV5CurrentTurnDelta.test.ts`
- `weeklyPlanningComponentParentNormalizationV5.ts` and tests
- `weeklyPlanningExistingEntityBindingV5.ts` and cross-turn binding tests
- `weeklyPlanningDurableContextSignalsV5.ts` and tests
- `weeklyPlanningCopiedUserContextNormalizationV5.ts` and tests
- `UserPlanningContextSpace` implementation / tests
- `weeklyPlanningResumableConversation.observation.test.ts`
- `.github/workflows/weekly-planning-resumable-conversation-turn.yml`

These are production/evaluation behavior already represented in code and tests, not unfinished task specifications. New defects in these areas should be tracked by a current Issue/task rather than reopening the old August 7 memos.
