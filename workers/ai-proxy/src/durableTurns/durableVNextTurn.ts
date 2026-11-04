import { createWeeklyPlanningStableV5DialogueRendererCore } from '../../../../src/features/weeklyPlanning/vnext/weeklyPlanningVNextV5Boundary';
import { executeIsolatedWeeklyPlanningVNextTurn } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextIsolatedTurn';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { createWeeklyPlanningVNextRuntimeInterpreter, VNEXT_OPTION_CHOICE_POLICY,
  VNEXT_OPTION_CHOICE_SEMANTIC_POLICY } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextRuntimeInterpreter';
import type { AiProxyWorkerEnv } from '../worker';
import type { DurableTurnExecute } from './durableTurnJob';
import { createDurableVNextOptionChoicePort } from './durableTurnProvider';
import { createDurableVNextTurnProvider } from './durableVNextProvider';

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
  const guardedDispatch: Parameters<DurableTurnExecute>[1] = (request, send) =>
    dispatch(request, send, { stopOnInfrastructureError: true });
  const client = createDurableVNextTurnProvider(env, userId, guardedDispatch, sourceIp, deadlineAt);
  const interpret = createWeeklyPlanningVNextRuntimeInterpreter({ ownerId: userId, conversationId: conversationId! }, {
    choice: createDurableVNextOptionChoicePort(env, userId, guardedDispatch,
      { policy: VNEXT_OPTION_CHOICE_POLICY, semanticPolicy: VNEXT_OPTION_CHOICE_SEMANTIC_POLICY }, sourceIp, deadlineAt),
    focusedRequestId: () => `${traceRequestId}:focused`,
  });
  return executeIsolatedWeeklyPlanningVNextTurn(payload, { client, interpret,
    createRenderer: options => createWeeklyPlanningStableV5DialogueRendererCore(client, options) });
}
