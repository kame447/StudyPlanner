import { describe, expect, it, vi } from 'vitest';
import { admitPreparedWeeklyPlanningTurn, prepareWeeklyPlanningTurn, type WeeklyPlanningTurnPreparationPorts } from './weeklyPlanningTurnPreparation';

const binding = { ownerId: 'o', chatId: 'c', conversationId: 'k', weekStartDate: '2026-11-02', revision: 1 };
function ports(overrides: Partial<WeeklyPlanningTurnPreparationPorts> = {}) {
  const calls: string[] = [];
  const state = {}; const index = {};
  const value: WeeklyPlanningTurnPreparationPorts = {
    isPlannerDataCurrent: () => { calls.push('data'); return true; },
    binding: () => ({ ...binding }), isRequestCurrent: () => true,
    stateIdentity: () => state, indexIdentity: () => index,
    preflight: async () => { calls.push('preflight'); },
    ...overrides,
  };
  return { ports: value, calls, state, index };
}

describe('the shared turn preparation', () => {
  it('checks data, loads the runtime preflight, and checks data again before it is ready', async () => {
    const h = ports();
    expect(await prepareWeeklyPlanningTurn(h.ports)).toEqual({ ready: true });
    expect(h.calls).toEqual(['data', 'preflight', 'data']);
  });
  it('reports stale planner data before the preflight without loading anything', async () => {
    const preflight = vi.fn(async () => undefined);
    const h = ports({ isPlannerDataCurrent: () => false, preflight });
    expect(await prepareWeeklyPlanningTurn(h.ports)).toEqual({ ready: false, reason: 'planner-data-changed' });
    expect(preflight).not.toHaveBeenCalled();
  });
  it('reports stale planner data that goes stale while the preflight awaits', async () => {
    let current = true;
    const h = ports({ isPlannerDataCurrent: () => current, preflight: async () => { current = false; } });
    expect(await prepareWeeklyPlanningTurn(h.ports)).toEqual({ ready: false, reason: 'planner-data-changed' });
  });
  it.each([
    ['no conversation binding', { binding: () => null }],
    ['an uncommitted request', { isRequestCurrent: () => false }],
  ])('asks to retry for %s, before the preflight', async (_name, override) => {
    const preflight = vi.fn(async () => undefined);
    expect(await prepareWeeklyPlanningTurn(ports({ ...override, preflight }).ports)).toEqual({ ready: false, reason: 'request-changed' });
    expect(preflight).not.toHaveBeenCalled();
  });
  it('asks to retry when the conversation state was replaced while the preflight awaited', async () => {
    let state = {}; const index = {};
    const h = ports({ stateIdentity: () => state, indexIdentity: () => index, preflight: async () => { state = {}; } });
    expect(await prepareWeeklyPlanningTurn(h.ports)).toEqual({ ready: false, reason: 'request-changed' });
  });
  it('asks to retry when the chat or the binding changed while the preflight awaited', async () => {
    let chat = {}; let revision = 1;
    const base = ports({ indexIdentity: () => chat, binding: () => ({ ...binding, revision }) });
    expect(await prepareWeeklyPlanningTurn({ ...base.ports, preflight: async () => { chat = {}; } })).toEqual({ ready: false, reason: 'request-changed' });
    chat = {};
    expect(await prepareWeeklyPlanningTurn({ ...base.ports, preflight: async () => { revision = 2; } })).toEqual({ ready: false, reason: 'request-changed' });
  });
  it('lets a failed lazy runtime reject, so nothing paid can run after it', async () => {
    const failure = new Error('chunk failed');
    const h = ports({ preflight: async () => { throw failure; } });
    await expect(prepareWeeklyPlanningTurn(h.ports)).rejects.toBe(failure);
    expect(h.calls).toEqual(['data']);
  });
});

describe('the shared admission after the preparation', () => {
  const start = (h: ReturnType<typeof ports>) => ({ state: h.state, index: h.index, binding: { ...binding } });
  it('admits a prepared turn that did not move', () => {
    const h = ports();
    expect(admitPreparedWeeklyPlanningTurn({ preparation: { ready: true }, start: start(h), ports: h.ports })).toEqual({ admitted: true });
  });
  it('rejects with the planner-data reason, from the preparation or from the lease at admission', () => {
    const h = ports();
    expect(admitPreparedWeeklyPlanningTurn({ preparation: { ready: false, reason: 'planner-data-changed' }, start: start(h), ports: h.ports }))
      .toEqual({ admitted: false, result: { accepted: false, draftCandidates: [], rejectionReason: 'planner-data-changed' } });
    const stale = ports({ isPlannerDataCurrent: () => false });
    expect(admitPreparedWeeklyPlanningTurn({ preparation: { ready: true }, start: start(stale), ports: stale.ports }))
      .toEqual({ admitted: false, result: { accepted: false, draftCandidates: [], rejectionReason: 'planner-data-changed' } });
  });
  it.each([
    ['a retry request', { ready: false as const, reason: 'request-changed' as const }, {}],
    ['a moved state', { ready: true as const }, { stateIdentity: () => ({}) }],
    ['a moved chat index', { ready: true as const }, { indexIdentity: () => ({}) }],
    ['a changed binding', { ready: true as const }, { binding: () => ({ ...binding, revision: 9 }) }],
    ['an uncommitted request', { ready: true as const }, { isRequestCurrent: () => false }],
  ])('rejects without a reason for %s', (_name, preparation, override) => {
    const base = ports(); const h = ports(override);
    expect(admitPreparedWeeklyPlanningTurn({ preparation, start: start(base), ports: h.ports }))
      .toEqual({ admitted: false, result: { accepted: false, draftCandidates: [] } });
  });
});
