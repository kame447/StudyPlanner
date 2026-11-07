import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProxyWorkerEnv } from '../worker';
import type { IsolatedWeeklyPlanningTurnInput, IsolatedWeeklyPlanningTurnResult } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn';
import type { WeeklyPlanningVNextDurableTurnInput } from '../../../../src/features/weeklyPlanning/vnext/application/weeklyPlanningVNextDurableTurn';
import { createInitialPlanningIntakeState } from '../../../../src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningTurnRequestContext } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningTemporalContext';

const executors = vi.hoisted(() => ({ vnext: vi.fn(), v5: vi.fn(), provider: vi.fn(), reference: vi.fn() }));
vi.mock('./durableVNextTurn', () => ({ executeDurableVNextJob: executors.vnext }));
vi.mock('../../../../src/features/weeklyPlanning/application/weeklyPlanningIsolatedTurn', () => ({
  executeIsolatedWeeklyPlanningTurn: executors.v5,
}));
vi.mock('./durableTurnProvider', () => ({
  createDurableTurnProvider: executors.provider, createDurableReplyReferenceChoicePort: executors.reference,
}));

import { WeeklyPlanningTurnDurableObject } from './weeklyPlanningTurnDurableObject';

const now = Date.parse('2026-11-07T06:00:00.000Z');
const sourceIp = '198.51.100.42';
function legacyTurn(): IsolatedWeeklyPlanningTurnInput {
  return { weekStartDate: '2026-11-02', graph: createEmptyWeeklyPlanningFactGraphV5(), userContextRecords: [],
    input: { userId: 'alice', conversationId: 'chat', traceRequestId: 'request', inputStateRevision: 0,
      messages: [], userText: '数学の相談', selectedDate: '2026-11-07', plans: [], scheduleTemplates: [],
      requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: new Date(now).toISOString(),
        timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }) } };
}
function result(message: string): IsolatedWeeklyPlanningTurnResult {
  return { result: { state: createInitialPlanningIntakeState(), message, draftCandidates: [] },
    stagedContextFacts: [], observedDate: '2026-11-07' };
}
function harness() {
  // Same transactional Map boundary as durableTurnStorage.test.ts. The real
  // storage adapter, DurableTurnJob and production alarm callback remain wired.
  let values = new Map<string, string>();
  const setAlarm = vi.fn(async (_time: number) => undefined);
  const storage = {
    get: async (keys: string[]) => new Map(keys.filter(key => values.has(key)).map(key => [key, values.get(key)!])),
    transaction: async (work: (transaction: unknown) => Promise<void>) => {
      const pending = new Map(values);
      await work({
        delete: async (keys: string[]) => { keys.forEach(key => pending.delete(key)); },
        put: async (rows: Record<string, string>) => { Object.entries(rows).forEach(([key, value]) => pending.set(key, value)); },
        setAlarm,
      });
      values = pending;
    },
    setAlarm,
  } as unknown as DurableObjectStorage;
  const env = {} as AiProxyWorkerEnv;
  const object = new WeeklyPlanningTurnDurableObject({ storage } as DurableObjectState, env);
  const identity = { ownerId: 'alice', conversationId: 'chat', requestId: 'request', baseRevision: 0, startedAt: now };
  return { object, env, identity, setAlarm };
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('production Durable Object alarm core routing', () => {
  it('passes a persisted VNext envelope to the VNext executor without entering V5', async () => {
    const turn: WeeklyPlanningVNextDurableTurnInput = { core: 'vnext', input: legacyTurn().input,
      weekStartDate: '2026-11-02', checkpoint: null, legacyV5Checkpoint: null };
    const output = JSON.stringify({ ...result('VNext reply'), core: 'vnext', checkpointBefore: null, checkpointAfter: 'next-checkpoint' });
    executors.vnext.mockResolvedValue(output);
    const h = harness();
    expect(await h.object.accept({ ...h.identity, sourceIp, payload: JSON.stringify(turn) }))
      .toMatchObject({ accepted: true, value: { status: 'queued' } });
    expect(h.setAlarm).toHaveBeenCalled();

    await h.object.alarm();

    expect(executors.vnext).toHaveBeenCalledExactlyOnceWith(h.env, turn, expect.any(Function), sourceIp, expect.any(Number));
    expect(executors.v5).not.toHaveBeenCalled();
    expect(executors.provider).not.toHaveBeenCalled();
    expect(await h.object.status(h.identity)).toMatchObject({ status: 'completed', result: output });
  });

  it('passes a persisted versionless V5 envelope to V5 and serializes its result', async () => {
    const turn = legacyTurn();
    const output = result('V5 reply');
    const client = { complete: vi.fn() };
    executors.provider.mockReturnValue(client);
    executors.v5.mockResolvedValue(output);
    const h = harness();
    expect(turn).not.toHaveProperty('core');
    expect(await h.object.accept({ ...h.identity, sourceIp, payload: JSON.stringify(turn) }))
      .toMatchObject({ accepted: true, value: { status: 'queued' } });

    await h.object.alarm();

    expect(executors.vnext).not.toHaveBeenCalled();
    expect(executors.provider).toHaveBeenCalledExactlyOnceWith(h.env, 'alice', expect.any(Function), sourceIp, expect.any(Number));
    expect(executors.v5).toHaveBeenCalledOnce();
    expect(executors.v5.mock.calls[0].slice(0, 2)).toEqual([turn, client]);
    expect(await h.object.status(h.identity)).toMatchObject({ status: 'completed', result: JSON.stringify(output) });
  });
});
