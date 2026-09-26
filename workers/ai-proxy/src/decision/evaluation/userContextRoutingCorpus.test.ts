import { describe, expect, it } from 'vitest';
import {
  USER_CONTEXT_ROUTING_CORPUS,
  userContextRoutingCorpus,
  validateUserContextRoutingCorpus,
} from './userContextRoutingCorpus';

describe('user-context routing corpus', () => {
  it('seals disjoint tuning and holdout cases with thick negative classes', () => {
    expect(() => validateUserContextRoutingCorpus()).not.toThrow();
    const tuning = userContextRoutingCorpus('tuning');
    const holdout = userContextRoutingCorpus('holdout');
    expect(tuning).toHaveLength(52);
    expect(holdout).toHaveLength(64);
    expect(new Set(tuning.map((item) => item.currentUserText)))
      .not.toEqual(new Set(holdout.map((item) => item.currentUserText)));
    for (const evaluationClass of [
      'external_clear',
      'user_context_negative',
      'mixed_negative',
      'security_negative',
    ] as const) {
      const cases = holdout.filter((item) => item.evaluationClass === evaluationClass);
      expect(cases.length).toBeGreaterThanOrEqual(12);
      expect(new Set(cases.map((item) => item.conversationGroupId)).size)
        .toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps mixed hard cases pending one limited-judge batch', () => {
    const mixed = USER_CONTEXT_ROUTING_CORPUS.filter((item) =>
      item.evaluationClass === 'mixed_negative');
    expect(mixed.length).toBeGreaterThan(0);
    expect(mixed.every((item) =>
      item.labelStatus === 'needs_opus_5_5_limited_judge'
      && item.expectedRoute === 'luna'
      && item.expectedTargetDomain === null)).toBe(true);
  });

  it('never calls a synthetic label human gold', () => {
    expect(JSON.stringify(USER_CONTEXT_ROUTING_CORPUS)).not.toContain('human_gold');
    expect(JSON.stringify(USER_CONTEXT_ROUTING_CORPUS)).not.toContain('accuracy');
  });
});
