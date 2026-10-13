import { describe, expect, it, vi } from 'vitest';
import { executeDurableWeeklyTurn, cancelDurableWeeklyTurn, readDurableWeeklyTurnReceipt, saveDurableWeeklyTurnReceipt, type DurableTurnClientPorts } from './weeklyPlanningDurableTurnClient';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { durableReceipt } from './weeklyPlanningDurableTurn.testUtils';
function harness() {
  const receipt = durableReceipt(); let now = Date.parse(receipt.pending.startedAt);
  const fetch = vi.fn<typeof globalThis.fetch>(); const token = vi.fn(async () => 'owner-token');
  const ports: DurableTurnClientPorts = { fetch, token, endpoint: 'https://proxy.test/weekly-planning/turns',
    now: () => now, wait: async (ms) => { now += ms; } };
  const identity = { ownerId: receipt.ownerId, conversationId: receipt.pending.conversationId,
    requestId: receipt.pending.requestId, baseRevision: receipt.pending.baseRevision, startedAt: now };
  const completed = { result: { message: 'reply', state: {}, draftCandidates: [] }, stagedContextFacts: [], observedDate: '2026-10-14' };
  const response = (status: string, extra = {}) => Response.json({ identity, status, expiresAt: now + 86_400_000,
    ...(status === 'completed' ? { result: JSON.stringify(completed) } : {}), ...extra });
  return { receipt, fetch, ports, response, completed, identity };
}

describe('durable browser turn transport', () => {
  it('accepts once and only polls afterward', async () => {
    const h = harness(); h.fetch.mockResolvedValueOnce(h.response('queued')).mockResolvedValueOnce(h.response('running')).mockResolvedValueOnce(h.response('completed'));
    expect(await executeDurableWeeklyTurn(h.receipt, { ports: h.ports })).toEqual(h.completed);
    expect(h.fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'GET']);
  });
  it('reconciles an accepted but lost POST response without submitting again', async () => {
    const h = harness(); h.fetch.mockRejectedValueOnce(new TypeError('connection closed')).mockResolvedValueOnce(h.response('completed'));
    await executeDurableWeeklyTurn(h.receipt, { ports: h.ports });
    expect(h.fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
  });
  it('only resends the same identity after status proves the first POST was not accepted', async () => {
    const h = harness(); h.fetch.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(h.response('queued')).mockResolvedValueOnce(h.response('completed'));
    await executeDurableWeeklyTurn(h.receipt, { ports: h.ports });
    expect(h.fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'POST', 'GET']);
    expect(h.fetch.mock.calls[0][1]?.body).toEqual(h.fetch.mock.calls[2][1]?.body);
  });
  it('resumes a reload using only GET, including temporary fetch failures', async () => {
    const h = harness(); h.fetch.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(h.response('running')).mockResolvedValueOnce(h.response('completed'));
    await executeDurableWeeklyTurn(h.receipt, { ports: h.ports, resumeOnly: true });
    expect(h.fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
  it('does not create a replacement when a resumed request is missing or failed', async () => {
    for (const response of [new Response(null, { status: 404 }), harness().response('failed')]) {
      const h = harness(); h.fetch.mockResolvedValueOnce(response);
      await expect(executeDurableWeeklyTurn(h.receipt, { ports: h.ports, resumeOnly: true })).rejects.toThrow();
      expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.fetch.mock.calls[0][1]?.method).toBe('GET');
    }
  });
  it('rejects wrong owner, conversation, request or revision results', async () => {
    for (const change of [{ ownerId: 'bob' }, { conversationId: 'other' }, { requestId: 'other' }, { baseRevision: 9 }]) {
      const h = harness(); h.fetch.mockResolvedValueOnce(h.response('completed', { identity: { ...h.identity, ...change } }));
      await expect(executeDurableWeeklyTurn(h.receipt, { ports: h.ports, resumeOnly: true })).rejects.toThrow('識別');
    }
  });
  it('does not touch the server after local ownership changes', async () => {
    const h = harness(); await expect(executeDurableWeeklyTurn(h.receipt, { ports: h.ports, isCurrent: () => false })).rejects.toThrow();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('ends on rejected acceptance, unknown state or malformed completion without polling', async () => {
    for (const response of [Response.json({}, { status: 409 }), Response.json({}, { status: 429 }),
      Response.json({}, { status: 422 }), harness().response('unknown'), harness().response('completed', { result: null })]) {
      const h = harness(); h.fetch.mockResolvedValueOnce(response);
      await expect(executeDurableWeeklyTurn(h.receipt, { ports: h.ports })).rejects.toThrow();
      expect(h.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('retains an unacknowledged explicit cancellation and never resumes it as work', async () => {
    const h = harness(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(h.identity.startedAt);
    const restore = installWeeklyPlanningTestStorage(createMemoryStorageHarness().storage);
    try {
      saveDurableWeeklyTurnReceipt(h.receipt); h.fetch.mockRejectedValueOnce(new TypeError('offline'));
      expect(await cancelDurableWeeklyTurn(h.receipt.ownerId, h.receipt.pending.requestId, h.ports)).toBe(false);
      const receipt = readDurableWeeklyTurnReceipt(h.receipt.ownerId)!; expect(receipt.cancelRequested).toBe(true);
      await expect(executeDurableWeeklyTurn(receipt, { ports: h.ports, resumeOnly: true })).rejects.toThrow('キャンセル');
      h.fetch.mockResolvedValueOnce(h.response('failed', { failure: 'cancelled' }));
      expect(await cancelDurableWeeklyTurn(h.receipt.ownerId, h.receipt.pending.requestId, h.ports)).toBe(true);
      expect(readDurableWeeklyTurnReceipt(h.receipt.ownerId)).toBeNull();
      expect(h.fetch.mock.calls.every(([, init]) => init?.method === 'DELETE')).toBe(true);
    } finally { restore(); vi.useRealTimers(); }
  });

});
