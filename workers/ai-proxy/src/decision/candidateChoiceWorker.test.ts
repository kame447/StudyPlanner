import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { CANDIDATE_CHOICE_CATALOG_VERSION } from '../../../../shared/candidateChoiceDecision';
import { JEV_MODEL } from './decisionPolicy';
import { choiceRequest } from '../../../../shared/candidateChoiceFixtures.testUtils';
const env = { OPENAI_API_KEY: 'fixture-openai', OPENROUTER_API_KEY: 'fixture-jev', FIREBASE_WEB_API_KEY: 'fixture-project', ALLOWED_ORIGIN: 'https://app.test', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100', AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 1 }) }) } };
async function execute(request = choiceRequest(), overrides: Record<string, unknown> = {}, mode = 'canary') {
  return worker.fetch(new Request('https://proxy.test/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer fixture', Origin: 'https://app.test' },
    body: JSON.stringify({ purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: request.wholeUtterance }], decisionContext: { purpose: 'candidate_choice', request }, semanticCensus: { sentinel: 'proxy-only-census' }, ...overrides }) }), { ...env, JEV_CANDIDATE_CHOICE_MODE: mode, JEV_MODE: mode } as never);
}
function install(providerMode: 'evaluated' | 'invalid' | 'error' = 'evaluated') {
  const bodies: Record<string, unknown>[] = []; const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = String(input); urls.push(url);
    if (url.includes('identitytoolkit')) return Response.json({ users: [{ localId: 'fixture-owner', emailVerified: true }] });
    if (url.endsWith('/api/alpha/decisions')) {
      bodies.push(JSON.parse(String(init?.body)));
      if (providerMode === 'error') return Response.json({ error: 'fixture failure' }, { status: 502 });
      if (providerMode === 'invalid') return Response.json({ model: JEV_MODEL.responses[0], answers: {} });
      return Response.json({ model: JEV_MODEL.responses[0], answers: { candidate: { type: 'choice', choice: 'leaf:0', confidence: 0.999, probabilities: { 'leaf:0': 0.999, none: 0.001 } }, condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 } } });
    }
    if (url.endsWith('/chat/completions')) return Response.json({ model: JSON.parse(String(init?.body)).model, choices: [{ message: { content: 'ordinary Luna' } }] });
    throw new Error('Unexpected fixture endpoint');
  })); return { bodies, urls };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('generic Choice actual Worker boundary', () => {
  it('identifies an actual evaluated Jev response without changing response body bytes', async () => {
    const h = install(); const r = choiceRequest();
    const response = await execute(r);
    expect(h.bodies).toHaveLength(1);
    expect(response.headers.get('X-StudyPlanner-AI-Provider')).toBe('openrouter');
    expect(await response.text()).toBe(JSON.stringify({ status: 'evaluated', catalogVersion: CANDIDATE_CHOICE_CATALOG_VERSION,
      requestId: r.requestId, selectionEpoch: r.selectionEpoch, candidateSetHash: r.candidateSetHash, nodeId: r.menu.nodeId,
      optionId: 'leaf:0', probabilities: [{ optionId: 'leaf:0', probability: 0.999 }, { optionId: 'none', probability: 0.001 }],
      conditionChange: 0.001, independentMeaning: 0.001 }));
  });
  it.each(['off', 'shadow'])('does not claim a provider for unavailable %s; body bytes stay unchanged', async mode => {
    const h = install(); const response = await execute(choiceRequest(), {}, mode);
    expect(h.bodies).toEqual([]);
    expect(response.headers.get('X-StudyPlanner-AI-Provider')).toBeNull();
    expect(await response.text()).toBe(JSON.stringify({ status: 'unavailable', reason: mode === 'off' ? 'off' : 'not_selected' }));
  });
  it.each(['invalid', 'error'] as const)('does not claim an evaluated provider for %s dispatch', async mode => {
    const h = install(mode); const response = await execute();
    expect(h.bodies).toHaveLength(1);
    expect(response.headers.get('X-StudyPlanner-AI-Provider')).toBeNull();
    expect(await response.json()).toMatchObject({ status: 'unavailable' });
  });
  it('does not claim a provider for a rejected envelope', async () => {
    const h = install(); const response = await execute(choiceRequest(), { decisionContext: { purpose: 'candidate_choice', request: {} } });
    expect(response.status).toBe(400);
    expect(h.bodies).toEqual([]);
    expect(response.headers.get('X-StudyPlanner-AI-Provider')).toBeNull();
    expect(await response.text()).toBe(JSON.stringify({ error: 'Invalid candidate Choice context.' }));
  });
  it('carries question identity, target, scope and complete leaves in actual serialized Jev body', async () => {
    const h = install(); const r = choiceRequest();
    expect((await execute(r)).status).toBe(200);
    expect(h.bodies[0]).toMatchObject({ state: { context: r.context, currentUserText: r.wholeUtterance } });
    const catalog = h.bodies[0].questions as { candidate: { criteria: Record<string, string> } };
    expect(JSON.parse(catalog.candidate.criteria['leaf:0'])).toMatchObject({ tuple: { precision: 'exact', targetId: 'workload-1', measurement: 'total_duration', minutes: 30 } });
    expect(JSON.stringify(h.bodies[0])).not.toContain('proxy-only-census');
    expect(h.bodies[0]).not.toHaveProperty('semanticCensus');
    const changed = structuredClone(r); (changed.context.question as { code: string }).code = 'quantity_role_unresolved';
    await execute(changed);
    expect(h.bodies[1]).not.toEqual(h.bodies[0]);
    expect(h.urls.filter(u => u.endsWith('/chat/completions'))).toEqual([]);
  });
  it('rejects malformed envelopes and duplicated user-text disagreement before Jev exposure', async () => {
    const h = install();
    for (const patch of [{ decisionContext: { purpose: 'candidate_choice', request: { ...choiceRequest(), context: {} } } }, { messages: [{ role: 'user', content: 'different text' }] }, { purpose: 'user_context_interpreter' }]) expect((await execute(choiceRequest(), patch)).status).toBe(400);
    expect(h.bodies).toEqual([]);
  });
  it('off yields no provider call for opt-in candidate request; ordinary off Luna is unchanged', async () => {
    const h = install();
    expect(await (await execute(choiceRequest(), {}, 'off')).json()).toEqual({ status: 'unavailable', reason: 'off' });
    expect(h.bodies).toEqual([]);
    expect(await (await execute(choiceRequest(), { decisionContext: undefined }, 'off')).json()).toMatchObject({ content: 'ordinary Luna' });
    expect(h.urls.filter(u => u.endsWith('/chat/completions'))).toHaveLength(1);
  });
});
