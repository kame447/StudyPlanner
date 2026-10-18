import { describe, expect, it } from 'vitest';
import { evaluateCandidateChoice } from './candidateChoiceDispatch';
import { choiceRequest } from '../../../../shared/candidateChoiceFixtures.testUtils';
import { JEV_MODEL } from './decisionPolicy';
import { createSemanticRequestRecorder } from '../../../../shared/semanticDispatchRecorder';
import { createHash } from 'node:crypto';
import { CANDIDATE_CHOICE_QUESTION_CODES, isCandidateChoiceEvaluation } from '../../../../shared/candidateChoiceDecision';
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
  it('selects a prior utterance and slot without treating the unseen value as a complete candidate', async () => {
    const r = choiceRequest();
    const reference = { ...r, wholeUtterance: 'さっきの微積分を1問3分くらい',
      context: { ...r.context,
        question: { id: 'reply-target', code: 'reply_reference_target' },
        target: { kind: 'reply_reference', id: 'current_conversation' },
        scope: { referenceKind: 'existing_fact', selectionKind: 'target_slot_only',
          pendingQuestion: { messageOrdinal: 2, questionCode: 'stable_v5:missing_effort_estimate', candidateKeys: ['candidate-1'] },
          dialogueHistory: [
            { messageOrdinal: 1, role: 'user', content: '数学を20問進めたい' },
            { messageOrdinal: 2, role: 'assistant', content: '1問何分かかりますか？' },
          ],
        } } };
    let body: Record<string, unknown> = {};
    const result = await evaluateCandidateChoice({
      firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: reference },
      env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary',
        JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' },
      transport: async (_input, init) => {
        body = JSON.parse(String(init?.body)); return Response.json(response());
      },
    });
    expect(result.status).toBe('evaluated');
    expect(result).toMatchObject({ acceptanceScope: 'pending_question_answer' });
    expect(isCandidateChoiceEvaluation({ ...result, acceptanceScope: 'explicit_reference' }, reference)).toBe(false);
    const questions = body.questions as Record<string, { instructions: string; criteria: Record<string, string> }>;
    expect(questions.candidate.instructions).toContain('prior utterance');
    expect(questions.candidate.instructions).toContain('dialogueHistory');
    expect(questions.condition_change.instructions).toContain('current user reply only');
    expect((body.state as { context: { scope: { dialogueHistory: unknown[] } } }).context.scope.dialogueHistory)
      .toEqual(reference.context.scope.dialogueHistory);
    expect(questions.candidate.instructions).toContain('separate semantic extractor');
    expect(questions.condition_change.instructions).toContain('ordinary value');
    expect(questions.independent_meaning.instructions).toContain('multiple targets');
    // Both the question and true/false criteria must use the open-answer baseline.
    // A destination-only menu cannot require the free value to equal a full leaf.
    for (const key of ['condition_change', 'independent_meaning']) {
      expect(questions[key].instructions).toContain('pendingQuestion');
      expect(questions[key].criteria.false).not.toContain('complete candidate');
      expect(questions[key].criteria.false).toContain('value');
    }
    expect((body.state as { context: { scope: unknown } }).context.scope).toEqual(reference.context.scope);
    const none = (questions.candidate as { criteria: Record<string, string> }).criteria.none;
    expect(none).toContain('extracted separately');
  });
  it.each(CANDIDATE_CHOICE_QUESTION_CODES.filter(code => code !== 'reply_reference_target'))(
    'preserves the exact c8c32d12 non-reference catalog bytes for %s', async code => {
      const base = choiceRequest();
      const request = { ...base, context: { ...base.context, question: { ...base.context.question, code },
        ...(code === 'ambiguous_effort_estimate' ? { presentedQuestion: 'Which complete effort estimate?' } : {}) } };
      let serializedQuestions = '';
      const result = await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request },
        env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary',
          JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' },
        transport: async (_input, init) => {
          serializedQuestions = JSON.stringify(JSON.parse(String(init?.body)).questions);
          return Response.json(response());
        } });
      expect(result.status).toBe('evaluated');
      // SHA-256 snapshot from c8c32d12's complete questions object with choiceRequest().
      // Captured from that immutable dispatcher, not regenerated from the current code.
      expect(createHash('sha256').update(serializedQuestions).digest('hex'))
        .toBe('97bd2b873a1825321e7d1a1fea00e48289c94e02f92050f2cec05668a8ae3a01');
      expect(result).not.toHaveProperty('acceptanceScope');
    });
  it('marks a non-pending reference separately even when the provider heads report sufficiency', async () => {
    const base = choiceRequest();
    const request = { ...base, context: { ...base.context, question: { id: 'q', code: 'reply_reference_target' },
      scope: { pendingQuestion: null } } };
    const result = await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request },
      env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary',
        JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async () => Response.json(response()) });
    expect(result).toMatchObject({ status: 'evaluated', acceptanceScope: 'explicit_reference', conditionChange: 0.001, independentMeaning: 0.001 });
  });
  it('off/shadow/invalid question expose no provider state', async () => {
    let calls = 0;
    for (const mode of ['off', 'shadow']) expect((await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: choiceRequest() }, env: { JEV_CANDIDATE_CHOICE_MODE: mode, JEV_MODE: mode }, transport: async () => { calls++; return Response.json(response()); } })).status).toBe('unavailable');
    const r = choiceRequest(); const bad = { ...r, context: { ...r.context, question: { id: 'q', code: 'unknown' } } };
    expect((await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: bad }, env: { JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async () => { calls++; return Response.json(response()); } })).status).toBe('unavailable');
    expect(calls).toBe(0);
  });
  it('malformed distribution/model/unknown option cannot become a selection', async () => {
    for (const root of [{ ...response(), model: 'wrong' }, { ...response(), answers: { ...response().answers, candidate: { ...response().answers.candidate, choice: 'unknown' } } }, { ...response(), answers: { ...response().answers, candidate: { ...response().answers.candidate, probabilities: { 'leaf:0': 0.999, none: 0.1 } } } }]) {
      expect((await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: choiceRequest() }, env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async () => Response.json(root) })).status).toBe('unavailable');
    }
  });
  it('sends offset evidence without changing complete leaves or weakening whole-turn/C5 reference gate', async () => {
    const r = choiceRequest(); const withSpans = { ...r, uninterpretedSpans: [{ start: 0, end: 2 }], context: { ...r.context, presentedQuestion: 'Which complete effort estimate do you mean?', question: { id: 'q', code: 'ambiguous_effort_estimate' }, scope: { ...r.context.scope, reference: 'content_addressed_only' } } };
    let body: Record<string, unknown> = {};
    await evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: withSpans }, env: { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' }, transport: async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json(response()); } });
    expect(body).toMatchObject({ state: { uninterpretedSpans: [{ start: 0, end: 2 }], context: withSpans.context } });
    const catalog = body.questions as { candidate: { instructions: string; criteria: Record<string, string> } };
    expect(catalog.candidate.instructions).toContain('ordinal/deictic');
    expect(catalog.candidate.instructions).toContain('entire text including outside spans');
    expect(JSON.parse(catalog.candidate.criteria['leaf:0'])).toEqual(r.menu.options[0].kind === 'leaf' ? r.menu.options[0].candidate : null);
  });
  describe('2-decimal rounded distributions', () => {
    const env = { OPENROUTER_API_KEY: 'fixture', JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100', JEV_CANARY_PERCENT: '100' };
    const run = (probabilities: Record<string, number>, choice = 'leaf:0') => {
      const root = response(); root.answers.candidate = { ...root.answers.candidate, choice, probabilities };
      return evaluateCandidateChoice({ firebaseUid: 'fixture-owner', context: { purpose: 'candidate_choice', request: choiceRequest() }, env, transport: async () => Response.json(root) });
    };
    it('1.01 sum: scaled down, argmax kept, top and margin only shrink', async () => {
      const result = await run({ 'leaf:0': 0.9, none: 0.11 });
      expect(result).toMatchObject({ status: 'evaluated', optionId: 'leaf:0' });
      if (result.status !== 'evaluated') return;
      expect(result.probabilities[0].probability).toBeLessThan(0.9);
      expect(result.probabilities.reduce((t, p) => t + p.probability, 0)).toBeCloseTo(1, 12);
    });
    it('0.99 sum: missing mass goes to the runner-up, selected probability is never raised', async () => {
      const result = await run({ 'leaf:0': 0.89, none: 0.1 });
      expect(result).toMatchObject({ status: 'evaluated', optionId: 'leaf:0' });
      if (result.status !== 'evaluated') return;
      expect(result.probabilities[0].probability).toBe(0.89);
      expect(result.probabilities[1].probability).toBeCloseTo(0.11, 12);
    });
    it('leaves an exact vector byte-identical', async () => {
      const result = await run({ 'leaf:0': 0.9, none: 0.1 });
      expect(result).toMatchObject({ probabilities: [{ probability: 0.9 }, { probability: 0.1 }] });
    });
    it('rejects sums outside the rounding tolerance for the menu size with the provider reason', async () => {
      for (const none of [0.13, 0.07]) {
        expect(await run({ 'leaf:0': 0.9, none })).toEqual({ status: 'unavailable', reason: 'invalid_response' });
      }
      // Provider keeps its fixed 0.02 (shared by live purposes); the tighter 2-option rounding bound applies here.
      for (const none of [0.115, 0.085]) {
        expect(await run({ 'leaf:0': 0.9, none })).toEqual({ status: 'unavailable', reason: 'invalid_dispatch_response' });
      }
    });
    it('a repair that overtakes the selected option is rejected with the dispatch reason; a tie stays a tie for the gate to abstain on', async () => {
      expect(await run({ 'leaf:0': 0.495, none: 0.495 })).toEqual({ status: 'unavailable', reason: 'invalid_dispatch_response' });
      const tied = await run({ 'leaf:0': 0.5, none: 0.49 });
      expect(tied.status === 'evaluated' && tied.probabilities[0].probability === tied.probabilities[1].probability).toBe(true);
    });
  });
});
