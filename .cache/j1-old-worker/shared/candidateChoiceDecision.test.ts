import { describe, expect, it } from 'vitest';
import { isCandidateChoiceDecisionContext, isCandidateChoiceEvaluation } from './candidateChoiceDecision';
import { choiceEvaluation, choiceRequest } from './candidateChoiceFixtures.testUtils';
describe('generic Choice envelope', () => {
  it('accepts only a bounded full context/menu', () => {
    const context = { purpose: 'candidate_choice', request: choiceRequest() };
    expect(isCandidateChoiceDecisionContext(context)).toBe(true);
    for (const key of ['context', 'menu', 'requestId', 'selectionEpoch', 'candidateSetHash']) {
      const r = { ...context.request }; delete r[key as keyof typeof r];
      expect(isCandidateChoiceDecisionContext({ ...context, request: r })).toBe(false);
    }
    expect(isCandidateChoiceDecisionContext({ ...context, token: 'never-allowed' })).toBe(false);
    expect(isCandidateChoiceDecisionContext({ ...context, request: { ...context.request, context: { ...context.request.context, ownerId: 'private' } } })).toBe(false);
  });
  it('rejects duplicated/disagreeing menu identities and malformed leaves', () => {
    const r = choiceRequest();
    const malformed = [[], [r.menu.options[0], r.menu.options[0]], [...r.menu.options, r.menu.options[1]], Array.from({ length: 256 }, () => r.menu.options[1])];
    for (const options of malformed) expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: { ...r, menu: { ...r.menu, options } } })).toBe(false);
    expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: { ...r, context: { ...r.context, scope: { value: NaN } } } })).toBe(false);
  });
  it('validates exact correlation, normalized probabilities and catalog', () => {
    const r = choiceRequest(); const result = choiceEvaluation(r);
    expect(isCandidateChoiceEvaluation(result, r)).toBe(true);
    for (const patch of [{ selectionEpoch: 5 }, { requestId: 'other' }, { nodeId: 'other' }, { candidateSetHash: 'other' }, { catalogVersion: 'old' }, { optionId: 'unknown' }, { independentMeaning: NaN }, { probabilities: [{ optionId: 'leaf:0', probability: 0.8 }, { optionId: 'none', probability: 0.1 }] }]) {
      expect(isCandidateChoiceEvaluation({ ...result, ...patch }, r)).toBe(false);
    }
  });
  it('carries the same complete leaves in a hierarchy and bounds uninterpreted offsets without interpreting them', () => {
    const r = choiceRequest(); const leaf = r.menu.options.find(o => o.kind === 'leaf');
    if (!leaf || leaf.kind !== 'leaf') throw new Error('Fixture leaf missing');
    const grouped = { ...r, menu: { ...r.menu, kind: 'groups', options: [{ kind: 'group', id: 'group:0', candidates: [leaf.candidate] }, { kind: 'none', id: 'none' }] } };
    expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: grouped })).toBe(true);
    expect(grouped.menu.options[0]).toMatchObject({ candidates: [leaf.candidate] });
    expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: { ...r, uninterpretedSpans: [{ start: 0, end: r.wholeUtterance.length }] } })).toBe(true);
    for (const spans of [[{ start: -1, end: 1 }], [{ start: 0, end: r.wholeUtterance.length + 1 }], [{ start: 1, end: 1 }], [{ start: 0, end: 1, meaning: 'invented' }]]) {
      expect(isCandidateChoiceDecisionContext({ purpose: 'candidate_choice', request: { ...r, uninterpretedSpans: spans } })).toBe(false);
    }
  });
});
