/**
 * The decisions endpoint returns probabilities rounded to 2 decimals, so each entry carries up to 0.005 of rounding
 * error and an honest N-option distribution has |sum-1| <= 0.005*N. Candidate-choice dispatch only; the shared
 * provider check stays a fixed 0.02 because other live purposes rely on it. Larger drift is a malformed distribution and is rejected, never repaired.
 */
export function decisionProbabilitySumTolerance(optionCount: number): number {
  // 1e-9 absorbs float error exactly at the boundary (e.g. 0.9 + 0.09 - 1).
  return Math.min(0.02, 0.005 * optionCount) + 1e-9;
}

/** Matches the contract's own sum check (shared/candidateChoiceDecision.ts); inside it nothing is rewritten. */
const EXACT_SUM_EPSILON = 1e-6;

/**
 * Repair a rounded distribution so it sums to 1 without ever raising the selected probability or the margin over
 * the runner-up, i.e. it can only make a downstream threshold harder to meet:
 * - sum > 1: exact p/sum (monotonic: order and ties preserved, top and margin shrink).
 * - sum < 1: the missing mass goes to the best NON-selected option (first on a tie among them). If that overtakes
 *   or ties the selected option the contract/gate rejects it, never selecting it.
 * Returns null outside the rounding tolerance (or when not finite), so callers keep rejecting it.
 */
export function renormalizeRoundedProbabilities(values: readonly number[], selectedIndex: number): number[] | null {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0 || selectedIndex < 0 || selectedIndex >= values.length
    || Math.abs(sum - 1) > decisionProbabilitySumTolerance(values.length)) return null;
  if (Math.abs(sum - 1) <= EXACT_SUM_EPSILON) return [...values];
  if (sum > 1) return values.map(value => value / sum);
  let best = -1;
  values.forEach((value, i) => { if (i !== selectedIndex && (best < 0 || value > values[best])) best = i; });
  return values.map((value, i) => (i === best ? value + (1 - sum) : value));
}
