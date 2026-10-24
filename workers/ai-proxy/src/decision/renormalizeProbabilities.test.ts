import { describe, expect, it } from 'vitest';
import { decisionProbabilitySumTolerance, renormalizeRoundedProbabilities } from './renormalizeProbabilities';

describe('renormalizeRoundedProbabilities', () => {
  it('bounds tolerance by min(0.02, 0.005 N)', () => {
    expect(decisionProbabilitySumTolerance(2)).toBeCloseTo(0.01, 6);
    expect(decisionProbabilitySumTolerance(3)).toBeCloseTo(0.015, 6);
    expect(decisionProbabilitySumTolerance(40)).toBeCloseTo(0.02, 6);
  });
  it('sum>1 keeps order and ties; sum<1 never raises the selected entry', () => {
    const over = renormalizeRoundedProbabilities([0.34, 0.34, 0.33, 0.01], 0)!;
    expect(over[0]).toBe(over[1]);
    expect(over.reduce((t, v) => t + v, 0)).toBeCloseTo(1, 12);
    const under = renormalizeRoundedProbabilities([0.6, 0.2, 0.19], 0)!;
    expect(under[0]).toBe(0.6);
    expect(under[1]).toBeCloseTo(0.21, 12);
    expect(under[2]).toBe(0.19);
  });
  it('leaves sums inside the contract tolerance untouched', () => {
    expect(renormalizeRoundedProbabilities([0.9, 0.1 + 5e-7], 0)).toEqual([0.9, 0.1 + 5e-7]);
  });
  it('rejects outside tolerance and non-finite input', () => {
    expect(renormalizeRoundedProbabilities([0.9, 0.07], 0)).toBeNull();
    expect(renormalizeRoundedProbabilities([0.9, 0.13], 0)).toBeNull();
    expect(renormalizeRoundedProbabilities([Number.NaN, 1], 0)).toBeNull();
  });
});
