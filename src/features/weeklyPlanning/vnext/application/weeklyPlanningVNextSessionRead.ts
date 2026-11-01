// Checkpoint read and V5 migration, kept apart from the turn session so the entry chunk (the hook's
// local session) does not carry the session's projection, authorization and scheduling code.
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { parseWeeklyPlanningStableV5PersistedSession } from '../weeklyPlanningVNextV5Boundary';
import { migrateWeeklyPlanningV5GraphToVNextSession, parseWeeklyPlanningVNextSessionCheckpoint,
  type WeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import type { WeeklyPlanningVNextExperimentalPorts, WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

export type WeeklyPlanningVNextExperimentalRead =
  | { status: 'ready'; source: 'vnext' | 'migrated_v5' | 'empty'; checkpoint: WeeklyPlanningVNextSessionCheckpoint['vnext'] }
  /** Bytes that are neither format: never overwritten, never guessed. */
  | { status: 'unreadable' };

export function readWeeklyPlanningVNextExperimentalSession(
  scope: Pick<WeeklyPlanningVNextExperimentalScope, 'ownerId' | 'weekStartDate' | 'conversationId'>,
  ports: Pick<WeeklyPlanningVNextExperimentalPorts, 'checkpoint' | 'legacyV5Checkpoint'>,
): WeeklyPlanningVNextExperimentalRead {
  const raw = ports.checkpoint.read();
  if (raw !== null) {
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate });
    return parsed && parsed.conversationId === scope.conversationId
      ? { status: 'ready', source: 'vnext', checkpoint: parsed.vnext }
      : { status: 'unreadable' };
  }
  const legacy = ports.legacyV5Checkpoint.read();
  if (legacy === null) {
    return { status: 'ready', source: 'empty', checkpoint: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] } };
  }
  const v5 = parseWeeklyPlanningStableV5PersistedSession({ raw: legacy, ownerId: scope.ownerId, weekStartDate: scope.weekStartDate });
  if (!v5 || v5.conversationId !== scope.conversationId) return { status: 'unreadable' };
  // Presented questions and previews were made against the V5 revision; migration moves past it.
  return {
    status: 'ready',
    source: 'migrated_v5',
    checkpoint: { state: migrateWeeklyPlanningV5GraphToVNextSession(v5.graph, v5.planningState.intakeState?.groundingRecords,
      v5.planningState.intakeState?.draftGenerationIntent).state,
      presentedQuestion: null, preview: null, messages: [] },
  };
}
