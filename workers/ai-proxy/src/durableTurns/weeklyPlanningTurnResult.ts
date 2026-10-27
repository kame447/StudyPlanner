import type { IsolatedWeeklyPlanningTurnResult } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';
import { DURABLE_TURN_LIMITS } from './durableTurnJob';

/** Optional instrumentation must not turn an otherwise valid completion into a failed job. */
export function serializeWeeklyPlanningTurnResult(output: IsolatedWeeklyPlanningTurnResult): string {
  const serialized = JSON.stringify(output);
  const originalBytes = new TextEncoder().encode(serialized).byteLength;
  const events = output.result.debugTraceEvents;
  if (originalBytes <= DURABLE_TURN_LIMITS.outputBytes || !events) return serialized;
  const { debugTraceEvents: _events, ...result } = output.result;
  const withoutTrace = { ...output, result };
  if (events.length === 0) return JSON.stringify(withoutTrace);
  const bounded: IsolatedWeeklyPlanningTurnResult = { ...output, result: { ...output.result, debugTraceEvents: [{
    schemaVersion: 2, sequence: 0, stage: 'trace_collector_truncated', severity: 'warn',
    occurredAt: events[0].occurredAt,
    data: { reason: 'durable_output_limit', droppedEvents: events.length,
      originalBytes, maxOutputBytes: DURABLE_TURN_LIMITS.outputBytes },
  }] } };
  const withNotice = JSON.stringify(bounded);
  if (new TextEncoder().encode(withNotice).byteLength <= DURABLE_TURN_LIMITS.outputBytes) return withNotice;
  // At the exact cap even a notice may not fit. Preserve the product result;
  // the job still rejects a result whose non-diagnostic content exceeds its limit.
  return JSON.stringify(withoutTrace);
}
