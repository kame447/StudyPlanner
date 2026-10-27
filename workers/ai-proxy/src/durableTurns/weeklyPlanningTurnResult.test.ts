import { describe, expect, it } from 'vitest';
import { DurableTurnJob, DURABLE_TURN_LIMITS, type DurableTurnRecord, type DurableTurnStorage } from './durableTurnJob';
import { serializeWeeklyPlanningTurnResult } from './weeklyPlanningTurnResult';
import type { IsolatedWeeklyPlanningTurnResult } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';
import { createInitialPlanningIntakeState } from '../../../../src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';

function fixture(baseBytes: number): IsolatedWeeklyPlanningTurnResult {
  const output: IsolatedWeeklyPlanningTurnResult = { result: { state: createInitialPlanningIntakeState(), message: '', draftCandidates: [] },
    stagedContextFacts: [], observedDate: '2026-10-14' };
  output.result.message = 'x'.repeat(baseBytes - new TextEncoder().encode(JSON.stringify(output)).byteLength);
  return output;
}
function addTrace(output: IsolatedWeeklyPlanningTurnResult): void {
  output.result.debugTraceEvents = [{ schemaVersion: 2, sequence: 0, stage: 'semantic_provider_response',
    severity: 'debug', occurredAt: '2026-10-14T00:00:00.000Z', data: { rawResponse: '証拠'.repeat(1000) } }];
}
async function execute(output: IsolatedWeeklyPlanningTurnResult) {
  let saved: DurableTurnRecord | undefined;
  const storage: DurableTurnStorage = { read: async () => saved,
    write: async record => { saved = structuredClone(record); }, alarmAt: async () => {} };
  const identity = { ownerId: 'alice', conversationId: 'chat', requestId: 'turn', baseRevision: 0, startedAt: 1_000_000 };
  const job = new DurableTurnJob(storage, () => identity.startedAt);
  await job.accept({ ...identity, payload: '{}' });
  await job.run(async () => serializeWeeklyPlanningTurnResult(output));
  return job.status(identity);
}
describe('weekly planning result diagnostic output budget', () => {
  it('keeps a small result and its invocation trace unchanged', () => {
    const output = fixture(2000); addTrace(output);
    expect(serializeWeeklyPlanningTurnResult(output)).toBe(JSON.stringify(output));
  });
  it('completes a near-limit result with only trace replaced by an explicit notice', async () => {
    const output = fixture(DURABLE_TURN_LIMITS.outputBytes - 1000); addTrace(output);
    const before = structuredClone(output);
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeGreaterThan(DURABLE_TURN_LIMITS.outputBytes);
    const job = await execute(output);
    expect(job?.status).toBe('completed');
    expect(new TextEncoder().encode(job!.result!).byteLength).toBeLessThanOrEqual(DURABLE_TURN_LIMITS.outputBytes);
    const result = JSON.parse(job!.result!) as IsolatedWeeklyPlanningTurnResult;
    const { debugTraceEvents, ...content } = result.result;
    const { debugTraceEvents: _original, ...originalContent } = output.result;
    expect(content).toEqual(originalContent);
    expect(result.stagedContextFacts).toEqual(output.stagedContextFacts);
    expect(debugTraceEvents).toMatchObject([{ stage: 'trace_collector_truncated',
      data: { reason: 'durable_output_limit', droppedEvents: 1, maxOutputBytes: DURABLE_TURN_LIMITS.outputBytes } }]);
    expect(output).toEqual(before);
  });
  it('preserves completion even when the non-diagnostic result leaves no room for a notice', async () => {
    const output = fixture(DURABLE_TURN_LIMITS.outputBytes); addTrace(output);
    const job = await execute(output);
    expect(job?.status).toBe('completed');
    expect(new TextEncoder().encode(job!.result!).byteLength).toBe(DURABLE_TURN_LIMITS.outputBytes);
    expect(JSON.parse(job!.result!).result).not.toHaveProperty('debugTraceEvents');
  });
  it('also removes an empty optional trace when its JSON field would exceed the cap', async () => {
    const output = fixture(DURABLE_TURN_LIMITS.outputBytes); output.result.debugTraceEvents = [];
    const job = await execute(output);
    expect(job?.status).toBe('completed');
    expect(new TextEncoder().encode(job!.result!).byteLength).toBe(DURABLE_TURN_LIMITS.outputBytes);
    expect(JSON.parse(job!.result!).result).not.toHaveProperty('debugTraceEvents');
  });
  it.each([false, true])('retains result_too_large for a result exceeding the cap without optional trace (trace=%s)', async withTrace => {
    const output = fixture(DURABLE_TURN_LIMITS.outputBytes + 1);
    if (withTrace) addTrace(output);
    expect(await execute(output)).toMatchObject({ status: 'failed', failure: 'result_too_large' });
  });
});
