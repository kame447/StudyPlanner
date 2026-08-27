import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS,
  SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES,
  SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS,
  semanticNormalizerCompletionTokenBudgetV5,
} from './weeklyPlanningSemanticNormalizerRunV5';

describe('Stable V5 dense semantic turn budget', () => {
  it('keeps ordinary turns on the normal completion budget', () => {
    expect(semanticNormalizerCompletionTokenBudgetV5({
      userText: '来週までに英単語220語を進めたいです。',
    })).toBe(SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS);
  });

  it('gives dense user turns enough room for the structured semantic delta', () => {
    const denseText = '学習条件をまとめて指定します。'.repeat(
      Math.ceil(SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES / 42),
    );
    expect(new TextEncoder().encode(denseText).byteLength)
      .toBeGreaterThanOrEqual(SEMANTIC_NORMALIZER_V5_DENSE_TURN_USER_TEXT_BYTES);
    expect(semanticNormalizerCompletionTokenBudgetV5({ userText: denseText }))
      .toBe(SEMANTIC_NORMALIZER_V5_DENSE_TURN_MAX_COMPLETION_TOKENS);
  });
});
