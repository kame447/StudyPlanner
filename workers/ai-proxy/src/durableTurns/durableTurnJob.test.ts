import { describe, expect, it, vi } from 'vitest';
import { DurableTurnJob, DURABLE_TURN_LIMITS as limits, type DurableTurnInput, type DurableTurnRecord, type DurableTurnStorage } from './durableTurnJob';

function harness() {
  let now = 1_000_000;
  let value: DurableTurnRecord | undefined;
  const alarms: number[] = [];
  const storage: DurableTurnStorage = {
    read: vi.fn(async () => value && structuredClone(value)),
    write: vi.fn(async (record, alarmAt) => { value = structuredClone(record); if (alarmAt !== undefined) alarms.push(alarmAt); }),
    alarmAt: vi.fn(async (time) => { alarms.push(time); }),
  };
  const create = () => new DurableTurnJob(storage, () => now);
  const input: DurableTurnInput = { ownerId: 'alice', conversationId: 'conversation', requestId: 'turn-1', baseRevision: 0, startedAt: now, payload: '{"userText":"math"}' };
  return { storage, create, input, alarms, advance: (ms: number) => { now += ms; }, read: () => structuredClone(value), now: () => now };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

 describe('durable turn ownership and bounded acceptance', () => {
  it('accepts once after a lost response; poll and duplicate acceptance never dispatch', async () => {
    const h = harness(); const job = h.create();
    const a = await job.accept(h.input);
    expect(await job.accept(h.input)).toEqual(a);
    expect(await job.status(h.input)).toEqual(a);
    expect(h.read()?.journal).toEqual([]);
    expect(h.alarms).toHaveLength(2);
  });
  it('rejects a changed payload, revision, owner, or conversation', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    for (const change of [{ payload: 'changed' }, { baseRevision: 2 }]) await expect(job.accept({ ...h.input, ...change })).rejects.toMatchObject({ code: 'request_conflict' });
    for (const change of [{ ownerId: 'bob' }, { conversationId: 'other' }]) await expect(job.accept({ ...h.input, ...change })).rejects.toMatchObject({ code: 'owner_mismatch' });
    expect(await job.status({ ...h.input, ownerId: 'bob' })).toBeNull();
    expect(await job.status({ ...h.input, requestId: 'other' })).toBeNull();
  });
  it('serializes simultaneous acceptance and refuses a new job while one runs', async () => {
    const h = harness(); const job = h.create();
    const results = await Promise.allSettled([job.accept(h.input), job.accept({ ...h.input, requestId: 'turn-2', baseRevision: 2 })]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(h.read()?.identity.requestId).toBe('turn-1');
  });
  it('fences old requests even after a newer completed job replaces the record', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input); await job.run(async () => 'one');
    await expect(job.accept({ ...h.input, requestId: 'turn-2', baseRevision: 1 })).rejects.toMatchObject({ code: 'revision_conflict' });
    await job.accept({ ...h.input, requestId: 'turn-2', baseRevision: 2 }); await job.run(async () => 'two');
    await expect(job.accept(h.input)).rejects.toMatchObject({ code: 'revision_conflict' });
  });
  it.each([{ ownerId: '' }, { baseRevision: -1 }, { baseRevision: 0.5 }, { startedAt: NaN }, { payload: 'x'.repeat(limits.inputBytes + 1) }])('rejects invalid input case %#', async (change) => {
    const h = harness(); await expect(h.create().accept({ ...h.input, ...change })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('rejects stale and future first acceptance', async () => {
    const h = harness();
    for (const startedAt of [h.now() - limits.acceptanceAgeMs - 1, h.now() + 30_001]) await expect(h.create().accept({ ...h.input, startedAt })).rejects.toMatchObject({ code: 'expired_request' });
  });
});

describe('durable execution and uncertain completion', () => {
  it('continues semantic and rendering after the acceptance caller disconnects', async () => {
    const h = harness(); await h.create().accept(h.input);
    const semantic = deferred<string>(); const renderer = deferred<string>();
    const send = vi.fn().mockImplementationOnce(() => semantic.promise).mockImplementationOnce(() => renderer.promise);
    const job = h.create(); const execution = job.run(async (_payload, dispatch) => {
      const meaning = await dispatch('semantic', send); return dispatch(`renderer:${meaning}`, send);
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await job.status(h.input))?.status).toBe('running');
    semantic.resolve('meaning'); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    renderer.resolve('reply'); await execution;
    expect(await h.create().status(h.input)).toMatchObject({ status: 'completed', result: 'reply' });
    await h.create().run(async () => { throw new Error('must not execute'); });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('retains parallel provider responses completing out of order', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    const first = deferred<string>(); const second = deferred<string>();
    const sends = [vi.fn(() => first.promise), vi.fn(() => second.promise)];
    const running = job.run(async (_, dispatch) => JSON.stringify(await Promise.all([
      dispatch('first', sends[0]), dispatch('second', sends[1]),
    ])));
    await vi.waitFor(() => expect(sends.map((send) => send.mock.calls.length)).toEqual([1, 1]));
    second.resolve('two'); await vi.waitFor(() => expect(h.read()?.journal?.[1]).toMatchObject({ status: 'completed' }));
    first.resolve('one'); await running;
    expect(h.read()).toMatchObject({ status: 'completed', result: '["one","two"]' });
  });
  it('coalesces redelivery while the same instance runs', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    const gate = deferred<string>(); const execute = vi.fn(() => gate.promise);
    const first = job.run(execute); const second = job.run(execute); expect(second).toBe(first);
    gate.resolve('done'); await Promise.all([first, second]); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('never repeats a provider whose completion was uncertain after restart', async () => {
    const h = harness(); await h.create().accept(h.input);
    const original = h.storage.write;
    h.storage.write = async (record) => { await original(record); if (record.journal?.[0]?.status === 'started') throw new Error('eviction'); };
    const send = vi.fn(async () => 'reply'); const execute = (_: string, dispatch: Parameters<Parameters<DurableTurnJob['run']>[0]>[1]) => dispatch('semantic', send);
    await expect(h.create().run(execute)).rejects.toThrow(); h.storage.write = original;
    await h.create().run(execute);
    expect(send).not.toHaveBeenCalled();
    expect(h.read()).toMatchObject({ status: 'failed', failure: 'provider_completion_unknown' });
  });
  it('replays a persisted response after restart without another charge', async () => {
    const h = harness(); await h.create().accept(h.input); const original = h.storage.write;
    h.storage.write = async (record) => { await original(record); if (record.journal?.[0]?.status === 'completed') throw new Error('eviction'); };
    const send = vi.fn(async () => 'meaning');
    const execute = async (_: string, dispatch: Parameters<Parameters<DurableTurnJob['run']>[0]>[1]) => `${await dispatch('semantic', send)}:reply`;
    await expect(h.create().run(execute)).rejects.toThrow(); h.storage.write = original;
    await h.create().run(execute); expect(send).toHaveBeenCalledTimes(1);
    expect(h.read()).toMatchObject({ status: 'completed', result: 'meaning:reply' });
  });
  it('never overwrites a terminal result after commit-then-throw storage failure', async () => {
    const h = harness(); await h.create().accept(h.input); const original = h.storage.write;
    h.storage.write = async (record) => { await original(record); if (record.status === 'completed') throw new Error('lost commit receipt'); };
    const execute = vi.fn(async () => 'saved'); await expect(h.create().run(execute)).rejects.toThrow(); h.storage.write = original;
    await h.create().run(execute); expect(execute).toHaveBeenCalledTimes(1);
    expect(h.read()).toMatchObject({ status: 'completed', result: 'saved' });
  });
  it('does not accept fallback output after a caught provider failure', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    const send = vi.fn(async () => { throw new Error('disconnect'); });
    await job.run(async (_, dispatch) => { try { await dispatch('semantic', send); } catch { /* existing renderer may degrade */ } return 'fallback'; });
    await job.run(async () => 'retry'); expect(send).toHaveBeenCalledTimes(1);
    expect(h.read()).toMatchObject({ status: 'failed', failure: 'provider_failure' });
  });
  it('fails closed when replay code changes its provider request', async () => {
    const h = harness(); await h.create().accept(h.input);
    await h.storage.write({ ...h.read()!, status: 'running', journal: [{ fingerprint: 'different', status: 'completed', response: 'old' }] });
    const send = vi.fn(async () => 'new'); await h.create().run((_, dispatch) => dispatch('changed request', send));
    expect(send).not.toHaveBeenCalled(); expect(h.read()?.failure).toBe('execution_changed');
  });
  it('enforces the finite provider budget and execution deadline', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input); const send = vi.fn(async () => 'ok');
    await job.run(async (_, dispatch) => { for (let i = 0; i <= limits.dispatches; i++) await dispatch(String(i), send); return 'bad'; });
    expect(send).toHaveBeenCalledTimes(limits.dispatches); expect(h.read()?.failure).toBe('dispatch_limit');
    const h2 = harness(); await h2.create().accept(h2.input); h2.advance(limits.executionMs);
    await h2.create().run((_, dispatch) => dispatch('expired', send));
    expect(send).toHaveBeenCalledTimes(limits.dispatches); expect(h2.read()?.failure).toBe('execution_expired');
  });
  it('fails a runtime error rather than endlessly retrying application code', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    await job.run(async () => { throw new Error('runtime defect'); });
    expect(h.read()).toMatchObject({ status: 'failed', failure: 'execution_failed' });
  });
  it('bounds response and terminal output and removes all content at expiry', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    await job.run((_, dispatch) => dispatch('request', async () => 'x'.repeat(limits.responseBytes + 1)));
    expect(h.read()?.failure).toBe('result_too_large');
    const h2 = harness(); const job2 = h2.create(); await job2.accept(h2.input); await job2.run(async () => 'secret'); h2.advance(limits.retentionMs);
    expect(await job2.accept(h2.input)).toMatchObject({ status: 'expired' });
    expect(h2.read()).not.toHaveProperty('result'); expect(h2.read()).not.toHaveProperty('payload'); expect(h2.read()).not.toHaveProperty('journal');
    await job2.run(async () => { throw new Error('must not run'); });
  });
});


describe('explicit durable cancellation', () => {
  it('fences cancellation arriving before acceptance without any provider execution', async () => {
    const h = harness(); const job = h.create(); await job.cancel(h.input);
    await expect(job.accept(h.input)).rejects.toMatchObject({ code: 'request_conflict' });
    const execute = vi.fn(); await job.run(execute); expect(execute).not.toHaveBeenCalled();
    expect(await job.status(h.input)).toMatchObject({ status: 'failed', failure: 'cancelled' });
  });
  it('stops after the already dispatched call and never sends the renderer or overwrites a new turn', async () => {
    const h = harness(); const job = h.create(); await job.accept(h.input);
    const gate = deferred<string>(); const send = vi.fn(() => gate.promise); const renderer = vi.fn(async () => 'reply');
    const run = job.run(async (_payload, dispatch) => { const meaning = await dispatch('semantic', send); return dispatch(meaning, renderer); });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await job.cancel(h.input);
    expect(await job.cancel({ ...h.input, ownerId: 'bob' })).toBeNull();
    const next = { ...h.input, requestId: 'turn-2', baseRevision: 2 };
    await job.accept(next); gate.resolve('meaning'); await run;
    expect(renderer).not.toHaveBeenCalled(); expect((await job.status(next))?.status).toBe('queued');
    await job.run(async () => 'new reply'); expect(await job.status(next)).toMatchObject({ status: 'completed', result: 'new reply' });
    expect(await job.cancel(h.input)).toBeNull();
    expect(await job.status(next)).toMatchObject({ status: 'completed', result: 'new reply' });
  });
});


describe('claim and terminal state races', () => {
  it('serializes cancellation with a delayed running claim instead of reviving cancelled work', async () => {
    const h = harness(); const write = h.storage.write; const gate = deferred<void>(); let claiming = false;
    h.storage.write = async (value, alarm) => {
      if (value.status === 'running' && !claiming) { claiming = true; await gate.promise; }
      await write(value, alarm);
    };
    const job = h.create(); await job.accept(h.input); const send = vi.fn(async () => 'paid');
    const execution = job.run(async (_payload, dispatch) => dispatch('semantic', send));
    await vi.waitFor(() => expect(claiming).toBe(true));
    const cancellation = job.cancel(h.input); gate.resolve(); await cancellation; await execution;
    expect(send).not.toHaveBeenCalled(); expect(await job.status(h.input)).toMatchObject({ status: 'failed', failure: 'cancelled' });
  });
  it('does not let an old completion or failure replace cancellation and a newer accepted turn', async () => {
    for (const fail of [false, true]) {
      const h = harness(); const job = h.create(); await job.accept(h.input); const finish = deferred<string>();
      const execution = job.run(async () => { const result = await finish.promise; if (fail) throw new Error('late failure'); return result; });
      await vi.waitFor(() => expect(h.read()?.status).toBe('running'));
      await job.cancel(h.input); const next = { ...h.input, requestId: 'next', baseRevision: 2 }; await job.accept(next);
      finish.resolve('late old result'); await execution;
      expect(await job.status(next)).toMatchObject({ status: 'queued', identity: { requestId: 'next', baseRevision: 2 } });
      await job.run(async () => 'new result'); expect(await job.status(next)).toMatchObject({ status: 'completed', result: 'new result' });
    }
  });
});


it.each([false, true])('serializes the final read/write with cancellation and following acceptance (failure=%s)', async (fail) => {
  const h = harness(); const read = h.storage.read; const gate = deferred<void>(); let terminal = false; let paused = false;
  h.storage.read = async () => {
    const value = await read();
    if (terminal && !paused) { paused = true; await gate.promise; }
    return value;
  };
  const job = h.create(); await job.accept(h.input);
  const execution = job.run(async () => { terminal = true; if (fail) throw new Error('execution failed'); return 'reply'; });
  await vi.waitFor(() => expect(paused).toBe(true));
  let cancelSettled = false;
  const cancellation = job.cancel(h.input).then((result) => { cancelSettled = true; return result; });
  const next = { ...h.input, requestId: 'next', baseRevision: 2 };
  const acceptance = cancellation.then(() => job.accept(next));
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cancelSettled).toBe(false); // The terminal transaction still owns the short state boundary.
  } finally { gate.resolve(); }
  await execution; await acceptance;
  expect(await job.status(next)).toMatchObject({ status: 'queued', identity: { requestId: 'next', baseRevision: 2 } });
});
