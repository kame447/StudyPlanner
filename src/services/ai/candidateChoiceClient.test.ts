import { describe, expect, it, vi } from 'vitest';
import { choiceEvaluation, choiceRequest } from '../../../shared/candidateChoiceFixtures.testUtils';
import { createCandidateChoiceClient } from './candidateChoiceClient';
const semanticPolicy = { calibrationEvidenceId: 'synthetic-test-only', maximumConditionChange: 0.01, maximumIndependentMeaning: 0.01 };
describe('authenticated generic Choice client', () => {
  it('serializes minimal application request and keeps census only in the proxy body', async () => {
    const r = choiceRequest(); let body: Record<string, unknown> = {};
    const transport = vi.fn(async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json(choiceEvaluation(r)); });
    const before = vi.fn();
    const result = await createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://proxy.test', getToken: async () => 'secret', transport, semanticCensus: { version: 1, marker: 'typed-census-only' } }).choose(r, before);
    expect(before).toHaveBeenCalledOnce();
    expect(body).toEqual({ purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: r.wholeUtterance }], decisionContext: { purpose: 'candidate_choice', request: r }, semanticCensus: { version: 1, marker: 'typed-census-only' } });
    expect(JSON.stringify(body)).not.toContain('secret'); expect(body).not.toHaveProperty('semanticPolicy');
    expect(result).toMatchObject({ semanticSufficiency: 'only_candidate_meaning', optionId: 'leaf:0' });
  });
  it('rechecks after authentication; revocation prevents actual fetch', async () => {
    let allowed = true; const transport = vi.fn();
    const client = createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://proxy.test', getToken: async () => { allowed = false; return 'secret'; }, transport });
    await expect(client.choose(choiceRequest(), () => { if (!allowed) throw new Error('revoked'); })).rejects.toThrow('revoked');
    expect(transport).not.toHaveBeenCalled();
  });
  it('detaches request before authentication and rejects stale/old-worker output', async () => {
    const original = choiceRequest(); const r = structuredClone(original); let sent: unknown;
    const client = createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://proxy.test', getToken: async () => { (r.context.question as { code: string }).code = 'changed'; return 'secret'; },
      transport: async (_input, init) => { sent = JSON.parse(String(init?.body)); return Response.json(choiceEvaluation(original)); } });
    await client.choose(r, () => undefined);
    expect(sent).toMatchObject({ decisionContext: { request: { context: { question: { code: 'missing_effort_estimate' } } } } });
    for (const reply of [{ ...choiceEvaluation(original), requestId: 'stale' }, { content: 'old Worker Luna output' }, { status: 'unavailable', reason: 'off' }]) {
      await expect(createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://proxy.test', getToken: async () => 'secret', transport: async () => Response.json(reply) }).choose(original, () => undefined)).rejects.toThrow();
    }
  });
  it('cannot invent semantic calibration and vetoes auxiliary disagreement', async () => {
    expect(() => createCandidateChoiceClient({ semanticPolicy: { ...semanticPolicy, calibrationEvidenceId: '' } })).toThrow();
    const r = choiceRequest();
    const reply = await createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://proxy.test', getToken: async () => 'secret', transport: async () => Response.json({ ...choiceEvaluation(r), independentMeaning: 0.8 }) }).choose(r, () => undefined);
    expect(reply).toMatchObject({ semanticSufficiency: 'extra_or_uncertain_meaning' });
  });
  it('joins every node and fallback to one scope with unique census request IDs', async () => {
    const turnId = crypto.randomUUID(); const joins: Array<{ version: number; domain: string; turnId: string; requestId: string; stage: string }> = [];
    const observe = async <T>(stage: 'focused' | 'fallback', execute: (join: unknown) => Promise<T>) => {
      const join = { version: 1, domain: 'weekly-planning', turnId, requestId: crypto.randomUUID(), stage }; joins.push(join); return execute(join);
    };
    const censusBodies: unknown[] = []; const r = choiceRequest();
    const client = createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://proxy.test', getToken: async () => 'secret', semanticCensusObserver: { observe },
      transport: async (_input, init) => { censusBodies.push(JSON.parse(String(init?.body)).semanticCensus); return Response.json(choiceEvaluation(r)); } });
    await client.choose(r, () => undefined); await client.choose(r, () => undefined);
    await observe('fallback', async join => { censusBodies.push(join); return 'Luna fallback'; });
    expect(new Set(joins.map(j => j.requestId)).size).toBe(3);
    expect(new Set(joins.map(j => j.turnId))).toEqual(new Set([turnId])); expect(censusBodies).toEqual(joins);
  });
});
