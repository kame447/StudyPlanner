import { createWeeklyPlanningStableV5DialogueRendererCore } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { executeIsolatedWeeklyPlanningVNextTurn } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextIsolatedTurn';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY,
  VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeInterpreter';
import type { AiProxyWorkerEnv } from '../worker';
import type { DurableTurnExecute, DurableTurnExecutionResult } from './durableTurnJob';
import { createDurableTurnProvider, createDurableVNextOptionChoicePort } from './durableTurnProvider';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';

/** The browser's VNext composition over the journaled provider. Every request identity is derived from
 * the accepted turn id, so a replayed alarm reproduces each dispatch byte for byte.
 */
export function executeDurableVNextTurn(
  env: AiProxyWorkerEnv,
  payload: WeeklyPlanningVNextDurableTurnInput,
  dispatch: Parameters<DurableTurnExecute>[1],
  sourceIp?: string,
  deadlineAt?: number,
) {
  const { userId, conversationId, traceRequestId } = payload.input;
  const client = createDurableTurnProvider(env, userId, dispatch, sourceIp, deadlineAt);
  const interpret = createWeeklyPlanningVNextRuntimeInterpreter({ ownerId: userId, conversationId: conversationId! }, {
    choice: createDurableVNextOptionChoicePort(env, userId, dispatch,
      { policy: VNEXT_OPTION_CHOICE_POLICY, semanticPolicy: VNEXT_OPTION_CHOICE_SEMANTIC_POLICY }, sourceIp, deadlineAt),
    focusedRequestId: () => `${traceRequestId}:focused`,
  });
  return executeIsolatedWeeklyPlanningVNextTurn(payload, { client, interpret,
    createRenderer: options => createWeeklyPlanningStableV5DialogueRendererCore(client, options) });
}

/** The core owns both interpretation recovery and the renderer's unsaved-preview fallback. */
export async function executeDurableVNextJob(
  ...args: Parameters<typeof executeDurableVNextTurn>
): Promise<DurableTurnExecutionResult> {
  const output = await executeDurableVNextTurn(...args);
  const result = serializeWeeklyPlanningTurnResult(output);
  return output.result.failure?.code === 'stable_v5_provider_failure'
    || output.result.responseSource === 'deterministic_fallback'
    ? { kind: 'provider_failure_recovered', result }
    : result;
}
