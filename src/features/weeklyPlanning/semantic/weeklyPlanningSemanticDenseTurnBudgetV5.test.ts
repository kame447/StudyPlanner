import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS,
  SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES,
  SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
  semanticNormalizerCompletionTokenBudgetV5,
} from './weeklyPlanningSemanticNormalizerRunV5';

describe('Stable V5 semantic dense-turn completion budget', () => {
  it('keeps ordinary turns on the default budget', () => {
    expect(semanticNormalizerCompletionTokenBudgetV5({ userText: '英単語を勉強したいです' }))
      .toBe(SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS);
  });

  it('gives dense turns enough room for reasoning plus visible structured output', () => {
    const denseText = 'あ'.repeat(SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES);
    expect(semanticNormalizerCompletionTokenBudgetV5({ userText: denseText }))
      .toBe(SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS);
    expect(SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS).toBe(6400);
  });
});
