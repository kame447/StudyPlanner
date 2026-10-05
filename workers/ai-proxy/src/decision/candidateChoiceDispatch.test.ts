import { describe, expect, it } from 'vitest';
import { evaluateCandidateChoice } from './candidateChoiceDispatch';
import { choiceRequest } from '../../../../shared/candidateChoiceFixtures.testUtils';
import { JEV_MODEL } from './decisionPolicy';
import { createSemanticRequestRecorder } from '../../../../shared/semanticDispatchRecorder';
function response() { return { model: JEV_MODEL.request, answers: { candidate: { type: 'choice', choice: 'leaf:0', confidence: 0.999, probabilities: { 'leaf:0': 0.999, none: 0.001 } }, condition_change: { type: 'noul', noul: 0.001 }, independent_meaning: { type: 'noul', noul: 0.001 } } }; }
describe('generic Choice provider validation and dispatch accounting', () => {
  it('records one actual dispatch with missing usage as NA, including provider failure', async () => {
    for (const fails of [false, true]) {
      const recorder = createSemanticRequestRecorder({ population: { source: 'synthetic', domain: 'weekly-planning', arm: 'treatment', corpusId: crypto.randomUUID() }, turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), stage: 'focused', boundary: 'worker' });
      const result = await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: choiceRequest() }, env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, recorder,
        transport: async () => { if (fails) throw new Error('provider-dispatched-failure'); return Response.json(response()); } });
      expect(result.status).toBe(fails ? 'unavailable' : 'evaluated'); recorder.finishMain(); await recorder.settle();
      expect(recorder.snapshot().dispatches).toHaveLength(1); expect(recorder.snapshot().dispatches[0].usage).toEqual({ inputTokens: null, outputTokens: null, costUsd: null });
    }
  });
  it('off/shadow/invalid question expose no provider state', async () => {
    let calls = 0;
    for (const mode of ['off', 'shadow']) expect((await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: choiceRequest() }, env: { JEV_CANDIDATE_CHOICE_MODE: mode, JEV_MODE: mode }, transport: async () => { calls++; return Response.json(response()); } })).status).toBe('unavailable');
    const r = choiceRequest(); const bad = { ...r, context: { ...r.context, question: { id: 'q', code: 'unknown' } } };
    expect((await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: bad }, env: { JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async () => { calls++; return Response.json(response()); } })).status).toBe('unavailable');
    expect(calls).toBe(0);
  });
  it('malformed distribution/model/unknown option cannot become a selection', async () => {
    for (const root of [{ ...response(), model: 'wrong' }, { ...response(), answers: { ...response().answers, candidate: { ...response().answers.candidate, choice: 'unknown' } } }, { ...response(), answers: { ...response().answers, candidate: { ...response().answers.candidate, probabilities: { 'leaf:0': 0.999, none: 0.01 } } } }]) {
      expect((await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: choiceRequest() }, env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async () => Response.json(root) })).status).toBe('unavailable');
    }
  });
  it('sends offset evidence without changing complete leaves or weakening whole-turn/C5 reference gate', async () => {
    const r = choiceRequest(); const withSpans = { ...r, uninterpretedSpans: [{ start: 0, end: 2 }], context: { ...r.context, question: { id: 'q', code: 'ambiguous_effort_estimate' }, scope: { ...r.context.scope, reference: 'content_addressed_only' } } };
    let body: Record<string, unknown> = {};
    await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: withSpans }, env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json(response()); } });
    expect(body).toMatchObject({ state: { uninterpretedSpans: [{ start: 0, end: 2 }], context: withSpans.context } });
    const catalog = body.questions as { candidate: { instructions: string; criteria: Record<string, string> } };
    expect(catalog.candidate.instructions).toContain('ordinal/deictic');
    expect(catalog.candidate.instructions).toContain('entire text including outside spans');
    expect(JSON.parse(catalog.candidate.criteria['leaf:0'])).toEqual(r.menu.options[0].kind === 'leaf' ? r.menu.options[0].candidate : null);
  });
});
