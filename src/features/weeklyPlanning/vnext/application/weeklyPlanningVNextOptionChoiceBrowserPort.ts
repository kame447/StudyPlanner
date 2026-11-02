import { createCandidateChoiceClient } from '../../../../services/ai/candidateChoiceClient';
import type { WeeklyPlanningVNextOptionChoicePort } from './weeklyPlanningVNextOptionChoice';

/** Reuse the authenticated client's validated observation, without widening its strict gate response.
 * A client per invocation keeps diagnostics local even when turns overlap. Diagnostics tests guard
 * the existing gate outcomes and full-input fallback; extend those when adding an outcome reason.
 */
export function createWeeklyPlanningVNextOptionChoicePort(params: {
  policy: WeeklyPlanningVNextOptionChoicePort['policy'];
  client: Omit<Parameters<typeof createCandidateChoiceClient>[0], 'onEvaluation'>;
}): WeeklyPlanningVNextOptionChoicePort {
  const semanticPolicy = Object.freeze({ ...params.client.semanticPolicy });
  return { policy: params.policy, choose: (request, beforeDispatch, observe) =>
    createCandidateChoiceClient({ ...params.client, semanticPolicy,
      onEvaluation: (_request, evaluation) => observe?.(evaluation, semanticPolicy),
    }).choose(request, beforeDispatch) };
}
