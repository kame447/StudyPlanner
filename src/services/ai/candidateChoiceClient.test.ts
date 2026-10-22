import { D5_TOP1_SCOPE } from '../../../shared/d5AnswerPolicy';
import { describe, expect, it, vi } from 'vitest';
import { choiceEvaluation, choiceRequest } from '../../../shared/candidateChoiceFixtures.testUtils';
import { createCandidateChoiceClient } from './candidateChoiceClient';
import { CANDIDATE_CHOICE_QUESTION_CODES } from '../../../shared/candidateChoiceDecision';
import { gateCandidateChoice } from '../../features/weeklyPlanning/application/candidateSelection/gate';
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
  it.each([0.499, 0.5, 0.501, 1])('v2 candidate authority ignores numeric auxiliary veto at %s; old policy stays inclusive', async score => {
    const base = choiceRequest();
    const request = { ...base, context: { ...base.context, scope: { ...base.context.scope, ...D5_TOP1_SCOPE } } };
    for (const r of [base, request]) {
      const result = await createCandidateChoiceClient({
        semanticPolicy: { calibrationEvidenceId: 'test-only', maximumConditionChange: 0.5, maximumIndependentMeaning: 0.5 },
        proxyUrl: 'https://fixture', getToken: async () => 'fixture',
        transport: async () => Response.json({ ...choiceEvaluation(r), conditionChange: score, independentMeaning: score }),
      }).choose(r, () => undefined);
      expect(result).toMatchObject({ semanticSufficiency: (r === request || score <= .5)
        ? 'only_candidate_meaning' : 'extra_or_uncertain_meaning' });
    }
  });
  it('accepts the v2 .59 leaf with raw .56/.50 heads through the unchanged common gate', async () => {
    const base = choiceRequest(); const r = { ...base, context: { ...base.context, scope: { ...base.context.scope, ...D5_TOP1_SCOPE } } };
    const evaluation = { ...choiceEvaluation(r), conditionChange: .56, independentMeaning: .50,
      probabilities: [{ optionId: 'leaf:0', probability: .59 }, { optionId: 'none', probability: .41 }] };
    const onEvaluation = vi.fn((_request, raw) => { raw.conditionChange = 0; });
    const adapted = await createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://fixture', getToken: async () => 'fixture',
      onEvaluation, transport: async () => Response.json(evaluation) }).choose(r, () => undefined);
    expect(onEvaluation).toHaveBeenCalledOnce();
    expect(evaluation.conditionChange).toBe(.56);
    expect(adapted).not.toHaveProperty('conditionChange');
    expect(gateCandidateChoice({ request: r, response: adapted, policy: { id: 'v2', calibrationEvidenceId: 'synthetic-only',
      rules: [{ menuKind: 'leaves', optionCount: 2, depth: 0, minimumTopProbability: 0, minimumMargin: 0 }] } }))
      .toEqual({ status: 'selected', optionId: 'leaf:0' });
  });
  it.each(['none', 'tie', 'malformed distribution', 'missing head', 'invalid head'])(
    'v2 still rejects %s with unchanged structural validation/common gate', async fault => {
      const base = choiceRequest(); const r = { ...base, context: { ...base.context, scope: { ...base.context.scope, ...D5_TOP1_SCOPE } } };
      const evaluation: any = { ...choiceEvaluation(r), conditionChange: .56, independentMeaning: .50 };
      if (fault === 'none') Object.assign(evaluation, { optionId: 'none', probabilities: [{ optionId: 'leaf:0', probability: .41 }, { optionId: 'none', probability: .59 }] });
      if (fault === 'tie') evaluation.probabilities = [{ optionId: 'leaf:0', probability: .5 }, { optionId: 'none', probability: .5 }];
      if (fault === 'malformed distribution') evaluation.probabilities[0].probability = .7;
      if (fault === 'missing head') delete evaluation.conditionChange;
      if (fault === 'invalid head') evaluation.independentMeaning = 1.01;
      const onEvaluation = vi.fn();
      const choose = createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://fixture', getToken: async () => 'fixture',
        onEvaluation, transport: async () => Response.json(evaluation) }).choose(r, () => undefined);
      if (fault !== 'none' && fault !== 'tie') {
        await expect(choose).rejects.toThrow('invalid candidate response'); expect(onEvaluation).not.toHaveBeenCalled();
      } else {
        const adapted = await choose;
        expect(gateCandidateChoice({ request: r, response: adapted, policy: { id: 'v2', calibrationEvidenceId: 'synthetic-only',
          rules: [{ menuKind: 'leaves', optionCount: 2, depth: 0, minimumTopProbability: 0, minimumMargin: 0 }] } }).status).toBe('rejected');
      }
    });
  it.each(CANDIDATE_CHOICE_QUESTION_CODES.filter(code => code !== 'missing_effort_estimate'))(
    'retains auxiliary veto for other question %s even with v2 scope', async code => {
      const base = choiceRequest(); const r = { ...base, context: { ...base.context, question: { ...base.context.question, code },
        scope: { ...base.context.scope, ...D5_TOP1_SCOPE }, presentedQuestion: 'Which complete value?' } };
      const adapted = await createCandidateChoiceClient({ semanticPolicy, proxyUrl: 'https://fixture', getToken: async () => 'fixture',
        transport: async () => Response.json({ ...choiceEvaluation(r), conditionChange: .56, independentMeaning: .50 }) }).choose(r, () => undefined);
      expect(adapted).toMatchObject({ semanticSufficiency: 'extra_or_uncertain_meaning' });
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
