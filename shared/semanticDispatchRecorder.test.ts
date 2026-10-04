import { describe, expect, it, vi } from 'vitest';
import { createSemanticRequestRecorder } from './semanticDispatchRecorder';

const params = () => ({ population: { source: 'fixture', domain: 'weekly-planning', arm: 'baseline', corpusId: crypto.randomUUID() } as const, turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), stage: 'initial' as const, boundary: 'worker' as const });

describe('invocation-local provider evidence', () => {
  it('best-effort instrumentation failure sends exactly once and preserves response', async () => {
    const recorder = createSemanticRequestRecorder({ ...params(), bestEffort: true, createId: () => { throw new Error('private-observer-failure'); } });
    const transport = vi.fn(async () => Response.json({ content: 'unchanged' }));
    expect(await (await recorder.providerFetch('openai', 'luna', 'initial', transport)('https://provider.test')).json()).toEqual({ content: 'unchanged' });
    expect(transport).toHaveBeenCalledTimes(1);
    recorder.finishMain(); await recorder.settle(); expect(recorder.snapshot().integrity).toBe('unknown');
  });
  it('best-effort clone failure never retries the provider or replaces its response', async () => {
    const recorder = createSemanticRequestRecorder({ ...params(), bestEffort: true });
    const response = Response.json({ content: 'unchanged' });
    vi.spyOn(response, 'clone').mockImplementation(() => { throw new Error('private-clone-failure'); });
    const transport = vi.fn(async () => response);
    expect(await recorder.providerFetch('openai', 'luna', 'initial', transport)('https://provider.test')).toBe(response);
    expect(transport).toHaveBeenCalledTimes(1);
    recorder.finishMain(); await recorder.settle(); expect(recorder.snapshot().integrity).toBe('unknown');
  });
  it('observes actual fetch including failed sends, and keeps missing usage unknown', async () => {
    const recorder = createSemanticRequestRecorder(params());
    const transport = vi.fn(async () => { throw new Error('private-user-provider-error'); });
    await expect(recorder.providerFetch('openai', 'luna', 'repair', transport)('https://provider.test')).rejects.toThrow();
    recorder.finishMain(); await recorder.settle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(recorder.snapshot()).toMatchObject({ integrity: 'complete', dispatches: [{ family: 'luna', stage: 'repair', outcome: 'network_error', usage: { inputTokens: null, outputTokens: null, costUsd: null } }] });
    expect(JSON.stringify(recorder.snapshot())).not.toContain('private-user-provider-error');
  });
  it('distinguishes abort before fetch from timeout after dispatch', async () => {
    const before = createSemanticRequestRecorder(params()); const controller = new AbortController(); controller.abort(new DOMException('private', 'TimeoutError'));
    const transport = vi.fn();
    await expect(before.providerFetch('openai', 'luna', 'initial', transport)('https://provider.test', { signal: controller.signal })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(before.snapshot().dispatches).toHaveLength(0);
    const after = createSemanticRequestRecorder(params()); const active = new AbortController();
    const send = vi.fn(async () => { active.abort(new DOMException('private', 'TimeoutError')); throw new Error('private'); });
    await expect(after.providerFetch('openai', 'luna', 'initial', send)('https://provider.test', { signal: active.signal })).rejects.toThrow();
    expect(after.snapshot().dispatches).toMatchObject([{ outcome: 'timeout' }]);
  });
  it('keeps late shadow/race work open after main completion, including nested provider completions', async () => {
    const recorder = createSemanticRequestRecorder(params());
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    recorder.track(wait.then(async () => {
      await recorder.providerFetch('openai', 'luna', 'shadow', async () => Response.json({ usage: { prompt_tokens: 2, completion_tokens: 1 } }))('https://provider.test');
    }));
    recorder.finishMain(); const settled = recorder.settle();
    expect(recorder.snapshot().settledAtMs).toBeNull();
    release(); await settled;
    expect(recorder.snapshot()).toMatchObject({ integrity: 'complete', dispatches: [{ stage: 'shadow', usage: { inputTokens: 2, outputTokens: 1, costUsd: null } }] });
    expect(recorder.snapshot().settledAtMs).not.toBeNull();
  });
  it('does not retain content, extra fields, provider errors, tokens or headers outside the allowlist', async () => {
    const sentinel = 'private-raw-japanese-sentinel';
    const input = params(); Object.assign(input.population, { rawUserText: sentinel });
    const recorder = createSemanticRequestRecorder(input);
    const response = await recorder.providerFetch('openrouter', 'jev', 'focused', async () => Response.json({ answers: sentinel, usage: { input_tokens: 20, output_tokens: 3, cost: 0.001 }, user: sentinel }))('https://provider.test/private', { headers: { Authorization: sentinel }, body: sentinel });
    expect(await response.json()).toHaveProperty('answers', sentinel);
    recorder.finishMain(); await recorder.settle();
    expect(JSON.stringify(recorder.snapshot())).not.toContain(sentinel);
    expect(recorder.snapshot().dispatches[0].usage).toEqual({ inputTokens: 20, outputTokens: 3, costUsd: 0.001 });
  });
  it('marks renderer, unobserved proxy and work registered after closure unknown', async () => {
    const recorder = createSemanticRequestRecorder(params());
    expect(recorder.matchesPurpose('weekly_planning_renderer')).toBe(false);
    recorder.markUnobservedProxy(); recorder.finishMain(); await recorder.settle();
    await recorder.track(Promise.resolve());
    expect(recorder.snapshot()).toMatchObject({ integrity: 'unknown', boundary: 'unobserved_proxy', dispatches: [] });
  });
  it('uses adapter evidence to distinguish an internal timeout from AbortError cancellation', async () => {
    const recorder = createSemanticRequestRecorder(params()); const controller = new AbortController();
    const ids: string[] = [];
    const transport = vi.fn(async () => { controller.abort(); throw controller.signal.reason; });
    await expect(recorder.providerFetch('openrouter', 'jev', 'focused', transport, (id) => ids.push(id))('https://provider.test', { signal: controller.signal })).rejects.toThrow();
    recorder.refineOutcome(ids, 'timeout'); recorder.finishMain(); await recorder.settle();
    expect(recorder.snapshot().dispatches).toMatchObject([{ outcome: 'timeout' }]);
  });
});

// Millisecond timestamps alone do not establish execution order.
it('retains post-main send completion even when the clock does not advance', async () => {
  const capture = createSemanticRequestRecorder({ population: { source: 'fixture', domain: 'weekly-planning', arm: 'baseline', corpusId: crypto.randomUUID() }, turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), stage: 'shadow', boundary: 'worker', now: () => 100 });
  let release!: (response: Response) => void;
  const transport = async () => new Promise<Response>((resolve) => { release = resolve; });
  const work = capture.providerFetch('openrouter', 'jev', 'shadow', transport)('https://provider.test');
  capture.finishMain(); release(Response.json({ usage: { input_tokens: 1, output_tokens: 1 } }));
  await work; await capture.settle();
  expect(capture.hasPostMainWork()).toBe(true);
  expect(capture.snapshot().dispatches[0].completedAtMs).toBe(capture.snapshot().mainCompletedAtMs);
});
