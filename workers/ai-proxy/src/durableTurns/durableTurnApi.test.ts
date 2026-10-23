import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDurableTurnApi, type DurableTurnApiEnv } from './durableTurnApi';
import { durableReceipt } from '../../../../src/features/weeklyPlanning/application/weeklyPlanningDurableTurn.testUtils';
import { DurableTurnJob, type DurableTurnRecord } from './durableTurnJob';

function harness() {
  const receipt = durableReceipt();
  let record: DurableTurnRecord | undefined;
  const job = new DurableTurnJob({ read: async () => structuredClone(record), write: async (next) => { record = structuredClone(next); }, alarmAt: async () => {} }, () => Date.parse(receipt.pending.startedAt));
  const accept = vi.fn(async (input: Parameters<typeof job.accept>[0]) => ({ accepted: true as const, value: await job.accept(input) }));
  const status = vi.fn((scope: Parameters<typeof job.status>[0]) => job.status(scope));
  const cancel = vi.fn((identity: Parameters<typeof job.cancel>[0]) => job.cancel(identity));
  const namespace = { getByName: vi.fn(() => ({ accept, status, cancel })) };
  const checkAndConsume = vi.fn(async (_request: { rules: Array<{ name: string }> }) => ({ allowed: true, retryAfterSeconds: 0 }));
  const env = { FIREBASE_WEB_API_KEY: 'test-web-key', OPENAI_API_KEY: 'test-provider-key', ALLOWED_ORIGIN: 'https://app.test',
    DURABLE_WEEKLY_TURNS: 'enabled', AI_TURNS: namespace, AI_QUOTA: { getByName: vi.fn(() => ({ checkAndConsume })) } } as unknown as DurableTurnApiEnv;
  const fetch = vi.fn(async () => Response.json({ users: [{ localId: 'alice', emailVerified: true }] })); vi.stubGlobal('fetch', fetch);
  const body = { conversationId: receipt.pending.conversationId, requestId: receipt.pending.requestId,
    baseRevision: receipt.pending.baseRevision, startedAt: Date.parse(receipt.pending.startedAt), payload: receipt.payload };
  const request = (value: unknown = body, headers: Record<string, string> = {}) => new Request('https://proxy.test/weekly-planning/turns', {
    method: 'POST', headers: { Authorization: 'Bearer test-token', Origin: 'https://app.test', 'CF-Connecting-IP': '192.0.2.1', ...headers }, body: JSON.stringify(value),
  });
  return { body, env, request, namespace, accept, status, fetch, checkAndConsume, cancel, job };
}
afterEach(() => vi.unstubAllGlobals());
describe('authenticated durable turn API', () => {
  it('accepts an owner-bound validated turn and never persists the bearer token', async () => {
    const h = harness(); const response = await handleDurableTurnApi(h.request(), h.env);
    expect(response.status).toBe(202); expect(h.namespace.getByName).toHaveBeenCalledWith(JSON.stringify(['alice', 'chat']));
    expect(h.accept).toHaveBeenCalledTimes(1); expect(JSON.stringify(h.accept.mock.calls)).not.toContain('test-token');
    expect(h.accept.mock.calls[0][0]).toMatchObject({ ownerId: 'alice', sourceIp: '192.0.2.1' });
    expect(h.checkAndConsume).toHaveBeenCalledTimes(2);
    expect(h.checkAndConsume.mock.calls.flatMap(([request]) => request.rules.map((rule) => rule.name)))
      .toEqual(['turn_acceptance:ip:minute', 'turn_acceptance:uid:minute', 'turn_acceptance:uid:day']);
  });
  it('authenticates every status read without consuming AI quota or accepting work', async () => {
    const h = harness(); const request = new Request('https://proxy.test/weekly-planning/turns?conversationId=chat&requestId=turn', { headers: { Authorization: 'Bearer test-token' } });
    expect((await handleDurableTurnApi(request, h.env)).status).toBe(404);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.status).toHaveBeenCalledWith({ ownerId: 'alice', conversationId: 'chat', requestId: 'turn' });
    expect(h.checkAndConsume).not.toHaveBeenCalled(); expect(h.accept).not.toHaveBeenCalled();
  });
  it('rejects missing authentication, wrong origin, unverified email and unavailable binding', async () => {
    const h = harness(); expect((await handleDurableTurnApi(h.request(h.body, { Authorization: '' }), h.env)).status).toBe(401);
    expect((await handleDurableTurnApi(h.request(h.body, { Origin: 'https://evil.test' }), h.env)).status).toBe(403);
    h.fetch.mockResolvedValueOnce(Response.json({ users: [{ localId: 'alice', emailVerified: false }] }));
    expect((await handleDurableTurnApi(h.request(), h.env)).status).toBe(403);
    expect((await handleDurableTurnApi(h.request(), { ...h.env, AI_TURNS: undefined })).status).toBe(503);
    expect(h.accept).not.toHaveBeenCalled();
  });
  it('rejects cross-owner payload, plan, context and changed request identity', async () => {
    const h = harness();
    for (const mutate of [
      (body: typeof h.body) => { body.payload.input.userId = 'bob'; },
      (body: typeof h.body) => { body.payload.input.plans = [{ userId: 'bob' }] as never; },
      (body: typeof h.body) => { body.payload.userContextRecords = [{ ownerId: 'bob' }] as never; },
      (body: typeof h.body) => { body.payload.input.traceRequestId = 'other'; },
      (body: typeof h.body) => { body.payload.input.inputStateRevision = 2; },
      (body: typeof h.body) => { body.payload.input.requestContext.currentDate = '2026-01-01'; },
      (body: typeof h.body) => { body.payload.input.requestContext.timeZone = 'invalid-zone'; },
      (body: typeof h.body) => { body.payload.input.requestContext.startedAtIso = '2026-01-01T00:00:00.000Z'; },
    ]) { const body = structuredClone(h.body); mutate(body); expect((await handleDurableTurnApi(h.request(body), h.env)).status).toBe(400); }
    expect(h.accept).not.toHaveBeenCalled();
  });
  it('carries only a structurally exact typed effort answer (#735)', async () => {
    const h = harness();
    const answer = { version: 1, kind: 'effort_duration', assistantMessageId: 'chat:turn:0:assistant', questionActionId: null,
      targetFactId: 'work', graphRevision: 0, effortMeasurement: 'duration_per_unit', minutes: 5 };
    for (const malformed of [{ ...answer, minutes: 4 }, { ...answer, extra: true }, 'raw text']) {
      const body = structuredClone(h.body) as typeof h.body & { payload: { input: Record<string, unknown> } };
      body.payload.input.machineBoundAnswer = malformed;
      expect((await handleDurableTurnApi(h.request(body), h.env)).status).toBe(400);
    }
    expect(h.accept).not.toHaveBeenCalled();
    const body = structuredClone(h.body) as typeof h.body & { payload: { input: Record<string, unknown> } };
    body.payload.input.machineBoundAnswer = answer;
    expect((await handleDurableTurnApi(h.request(body), h.env)).status).toBe(202);
    expect(JSON.parse(h.accept.mock.calls[0][0].payload).input.machineBoundAnswer).toEqual(answer);
  });
  it('applies admission quota before creating an object', async () => {
    const h = harness(); h.checkAndConsume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 20 });
    expect((await handleDurableTurnApi(h.request(), h.env)).status).toBe(429); expect(h.namespace.getByName).not.toHaveBeenCalled();
  });
  it('rejects streamed oversized bodies independent of Content-Length', async () => {
    const h = harness(); expect((await handleDurableTurnApi(h.request({ text: 'a'.repeat(1024 * 1024) }), h.env)).status).toBe(413);
    expect(h.accept).not.toHaveBeenCalled();
  });
  it('authenticates an exact cancellation identity and never invokes acceptance', async () => {
    const h = harness(); const query = new URLSearchParams({ conversationId: 'chat', requestId: 'chat:request:1',
      baseRevision: '0', startedAt: String(h.body.startedAt) });
    const response = await handleDurableTurnApi(new Request(`https://proxy.test/weekly-planning/turns?${query}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer test-token' },
    }), h.env);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ status: 'failed', failure: 'cancelled' });
    expect(h.cancel).toHaveBeenCalledWith({ ownerId: 'alice', conversationId: 'chat', requestId: 'chat:request:1', baseRevision: 0, startedAt: h.body.startedAt });
    expect(h.accept).not.toHaveBeenCalled();
  });

  it.each([undefined, 'disabled'])('rejects new acceptance with flag %s without preventing owner recovery or cancellation', async (flag) => {
    const h = harness();
    expect((await handleDurableTurnApi(h.request(), h.env)).status).toBe(202);
    const drained = { ...h.env, DURABLE_WEEKLY_TURNS: flag };
    h.accept.mockClear(); h.checkAndConsume.mockClear(); h.namespace.getByName.mockClear();
    expect((await handleDurableTurnApi(h.request(), drained)).status).toBe(503);
    expect(h.accept).not.toHaveBeenCalled(); expect(h.checkAndConsume).not.toHaveBeenCalled();
    expect(h.namespace.getByName).not.toHaveBeenCalled();
    const query = new URLSearchParams({ conversationId: h.body.conversationId, requestId: h.body.requestId,
      baseRevision: String(h.body.baseRevision), startedAt: String(h.body.startedAt) });
    const request = (method: string) => new Request(`https://proxy.test/weekly-planning/turns?${query}`, {
      method, headers: { Authorization: 'Bearer test-token', Origin: 'https://app.test' },
    });
    const polled = await handleDurableTurnApi(request('GET'), drained);
    expect(polled.status).toBe(200); expect(await polled.json()).toMatchObject({ status: 'queued', identity: { ownerId: 'alice' } });
    expect(h.checkAndConsume).not.toHaveBeenCalled();
    const cancelled = await handleDurableTurnApi(request('DELETE'), drained);
    expect(cancelled.status).toBe(200); expect(await cancelled.json()).toMatchObject({ status: 'failed', failure: 'cancelled' });
    expect(h.checkAndConsume).toHaveBeenCalledTimes(2);
    expect(h.accept).not.toHaveBeenCalled();
  });

  it('returns the same completed result while acceptance is disabled', async () => {
    const h = harness(); await handleDurableTurnApi(h.request(), h.env);
    const execute = vi.fn(async () => 'synthetic completed reply'); await h.job.run(execute);
    const query = new URLSearchParams({ conversationId: h.body.conversationId, requestId: h.body.requestId });
    for (let read = 0; read < 2; read += 1) {
      const response = await handleDurableTurnApi(new Request(`https://proxy.test/weekly-planning/turns?${query}`, {
        headers: { Authorization: 'Bearer test-token' },
      }), { ...h.env, DURABLE_WEEKLY_TURNS: 'disabled' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'completed', result: 'synthetic completed reply' });
    }
    expect(execute).toHaveBeenCalledTimes(1); expect(h.accept).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'DELETE'])('preserves authentication, origin, owner isolation and binding requirements for %s during drain', async (method) => {
    const h = harness(); await handleDurableTurnApi(h.request(), h.env);
    const drained = { ...h.env, DURABLE_WEEKLY_TURNS: 'disabled' };
    const query = new URLSearchParams({ conversationId: h.body.conversationId, requestId: h.body.requestId,
      baseRevision: String(h.body.baseRevision), startedAt: String(h.body.startedAt), ownerId: 'alice' });
    const request = (headers: Record<string, string> = {}) => new Request(`https://proxy.test/weekly-planning/turns?${query}`, {
      method, headers: { Authorization: 'Bearer test-token', Origin: 'https://app.test', ...headers },
    });
    expect((await handleDurableTurnApi(request({ Authorization: '' }), drained)).status).toBe(401);
    expect((await handleDurableTurnApi(request({ Origin: 'https://evil.test' }), drained)).status).toBe(403);
    expect((await handleDurableTurnApi(request(), { ...drained, AI_TURNS: undefined })).status).toBe(503);
    h.fetch.mockResolvedValueOnce(Response.json({ users: [{ localId: 'bob', emailVerified: true }] }));
    expect((await handleDurableTurnApi(request(), drained)).status).toBe(404);
    expect(h.namespace.getByName).toHaveBeenLastCalledWith(JSON.stringify(['bob', h.body.conversationId]));
    expect(await h.job.status({ ownerId: 'alice', conversationId: h.body.conversationId, requestId: h.body.requestId }))
      .toMatchObject({ status: 'queued' });
  });

});
