import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../services/ai/openAiCompatibleClient';
import { createSemanticTurnCensusScope, productionSemanticCensusOptions } from './semanticTurnCensus';
import type { SemanticCensusEvent } from '../../../shared/semanticTurnCensus';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const input = { purpose: 'weekly_planning_semantic_normalizer' as const, messages: [{ role: 'user' as const, content: 'private-utterance-sentinel' }] };
describe('semantic turn scope and best-effort closure', () => {
  it('shares per-request registration with separate Choice nodes and the whole-utterance fallback', async () => {
    const events: SemanticCensusEvent[] = []; const joins: unknown[] = [];
    const scope = createSemanticTurnCensusScope({ client: { createChatCompletion: async () => 'fallback' }, domain: 'weekly-planning', enabled: true, sink: { async write(event) { events.push(event); } } });
    for (let node = 0; node < 2; node++) await scope.client.semanticCensusObserver!.observe('focused', async (join) => { joins.push(join); return 'choice'; });
    await scope.client.createChatCompletion(input); scope.finish('success');
    const closure = events[1]; if (closure.kind !== 'closure') throw new Error('Missing closure');
    expect(closure.requestIds).toHaveLength(3); expect(new Set(closure.requestIds).size).toBe(3);
    expect(joins).toEqual(closure.requestIds.slice(0, 2).map((requestId) => ({ version: 1, domain: 'weekly-planning', turnId: closure.turnId, requestId, stage: 'focused' })));
  });
  it('generates fresh independent crypto IDs rather than deriving application identity', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const random = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => 'same') };
    const scope = createSemanticTurnCensusScope({ client, domain: 'weekly-planning', enabled: true, sink: { async write() {} } });
    await scope.client.createChatCompletion(input); await scope.client.createChatCompletion(input); scope.finish('success');
    expect(random).toHaveBeenCalledTimes(3);
    expect(vi.mocked(client.createChatCompletion).mock.calls.map(([request]) => request.semanticCensus)).toEqual([
      { version: 1, domain: 'weekly-planning', turnId: ids[0], requestId: ids[1], stage: 'initial' },
      { version: 1, domain: 'weekly-planning', turnId: ids[0], requestId: ids[2], stage: 'initial' },
    ]);
  });
  it('keeps invalid client timing unknown instead of clamping it to measured zero', () => {
    const events: SemanticCensusEvent[] = []; let clock = 100;
    const scope = createSemanticTurnCensusScope({ client: { createChatCompletion: async () => 'same' }, domain: 'weekly-planning', enabled: true, now: () => clock, sink: { async write(event) { events.push(event); } } });
    clock = 99; scope.finish('success');
    expect(events[1]).toMatchObject({ kind: 'closure', integrity: 'unknown', latencyMs: null });
  });
  it('is a source-default off no-op', () => {
    vi.stubEnv('VITE_SEMANTIC_CENSUS_MODE', 'off');
    expect(productionSemanticCensusOptions()).toEqual({ enabled: false });
    const client = { createChatCompletion: vi.fn() };
    const sink = { write: vi.fn() };
    expect(createSemanticTurnCensusScope({ client, domain: 'weekly-planning', enabled: false, sink }).client).toBe(client);
    expect(sink.write).not.toHaveBeenCalled();
  });
  it('joins multiple requests/retry and unawaited background calls, excluding contents and existing IDs', async () => {
    const events: SemanticCensusEvent[] = [];
    let release!: () => void;
    const late = new Promise<string>((resolve) => { release = () => resolve('private-generated-sentinel'); });
    const client: OpenAiCompatibleClient = { createChatCompletion: vi.fn().mockResolvedValueOnce('first').mockReturnValueOnce(late) };
    const scope = createSemanticTurnCensusScope({ client, domain: 'weekly-planning', enabled: true, sink: { async write(event) { events.push(event); } } });
    await scope.client.createChatCompletion(input);
    const background = scope.client.createChatCompletion({ ...input, semanticCensusStage: 'retry' });
    scope.finish('success');
    expect(events.map((event) => event.kind)).toEqual(['start']);
    release(); await background; await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.map((event) => event.kind)).toEqual(['start', 'closure']);
    const closure = events[1]; expect(closure).toMatchObject({ kind: 'closure', integrity: 'complete', semanticResolution: 'success' });
    if (closure.kind !== 'closure') throw new Error('Missing closure');
    expect(new Set(closure.requestIds).size).toBe(2);
    const calls = vi.mocked(client.createChatCompletion).mock.calls;
    expect(calls[1][0].semanticCensus).toMatchObject({ turnId: closure.turnId, stage: 'retry' });
    expect(JSON.stringify(events)).not.toContain('private-');
    const other = createSemanticTurnCensusScope({ client, domain: 'weekly-planning', enabled: true, sink: { async write(event) { events.push(event); } } });
    other.finish('success');
    expect(events[2].turnId).not.toBe(closure.turnId);
  });
  it.each(['sync', 'async'])('sink %s failure preserves the user response and makes no extra semantic call', async (mode) => {
    const client = { createChatCompletion: vi.fn(async () => 'same-user-result') };
    const scope = createSemanticTurnCensusScope({ client, domain: 'weekly-planning', enabled: true, sink: { write() { if (mode === 'sync') throw new Error('private-secret'); return Promise.reject(new Error('private-secret')); } } });
    expect(await scope.client.createChatCompletion(input)).toBe('same-user-result'); scope.finish('success');
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(client.createChatCompletion).toHaveBeenCalledTimes(1);
  });
  it('does not combine user-context and weekly-planning calls into complete evidence', async () => {
    const events: SemanticCensusEvent[] = [];
    const scope = createSemanticTurnCensusScope({ client: { createChatCompletion: async () => 'result' }, domain: 'user-context', enabled: true, sink: { async write(event) { events.push(event); } } });
    await scope.client.createChatCompletion(input); scope.finish('success');
    expect(events[1]).toMatchObject({ domain: 'user-context', integrity: 'unknown', requestIds: [] });
  });
});
