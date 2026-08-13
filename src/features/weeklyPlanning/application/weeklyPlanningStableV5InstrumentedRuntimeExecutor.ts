import type {
  WeeklyPlanningTurnExecutionResult,
} from '../weeklyPlanningTurnExecutor';
import {
  weeklyPlanningStableV5ResultProjector,
} from './weeklyPlanningStableV5ResultProjection';
import {
  executeWeeklyPlanningStableV5RuntimeTurn as executeWeeklyPlanningStableV5RuntimeTurnCore,
  type ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeExecutor';
import {
  weeklyPlanningStableV5RuntimeTraceLifecycle,
} from './weeklyPlanningStableV5RuntimeTraceLifecycle';
import {
  weeklyPlanningStableV5IdempotencyGate,
} from './weeklyPlanningStableV5TurnIdempotency';

export async function executeWeeklyPlanningStableV5RuntimeTurn(
  input: ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
): Promise<WeeklyPlanningTurnExecutionResult> {
  weeklyPlanningStableV5RuntimeTraceLifecycle.start(input);

  const idempotency = weeklyPlanningStableV5IdempotencyGate.evaluate(input);
  if (idempotency.kind === 'duplicate') {
    const { result } = idempotency;
    weeklyPlanningStableV5RuntimeTraceLifecycle.complete({
      input,
      result,
      severity: 'warn',
    });
    return result;
  }

  try {
    const coreResult = await executeWeeklyPlanningStableV5RuntimeTurnCore(input);
    const result = weeklyPlanningStableV5ResultProjector.core({
      input,
      result: coreResult,
    });
    weeklyPlanningStableV5RuntimeTraceLifecycle.complete({ input, result });
    return result;
  } catch (error) {
    weeklyPlanningStableV5RuntimeTraceLifecycle.fail({ input, error });
    throw error;
  }
}
