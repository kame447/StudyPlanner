import { describe, expect, it } from 'vitest';
import { renormalizeRoundedProbabilities } from './renormalizeProbabilities';

describe('renormalizeRoundedProbabilities', () => {
  it('preserves order and ties, and sums to 1', () => {
    const out = renormalizeRoundedProbabilities([0.33, 0.33, 0.33, 0.01])!;
    expect(out[0]).toBe(out[1]);
    expect(out[0]).toBeGreaterThan(out[3]);
    expect(out.reduce((t, v) => t + v, 0)).toBeCloseTo(1, 12);
  });
  it('rejects outside the rounding tolerance and non-finite input', () => {
    expect(renormalizeRoundedProbabilities([0.9, 0.07])).toBeNull();
    expect(renormalizeRoundedProbabilities([0.9, 0.13])).toBeNull();
    expect(renormalizeRoundedProbabilities([Number.NaN, 1])).toBeNull();
  });
});
