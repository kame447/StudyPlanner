/**
 * The decisions endpoint returns probabilities rounded to 2 decimals, so a valid distribution can sum to
 * 0.99/1.01 (each entry carries up to 0.005 of rounding error). The provider accepts |sum-1| up to this
 * bound; larger drift is a malformed distribution and is rejected, never repaired.
 */
export const DECISION_PROBABILITY_SUM_TOLERANCE = 0.02;

/**
 * Exact renormalisation (p / sum) of a distribution whose sum is within the rounding tolerance. Division by one
 * positive constant is monotonic and maps equal inputs to equal outputs, so the argmax and every tie are
 * preserved. Returns null when the sum is outside tolerance (or not finite), so callers keep rejecting it.
 */
export function renormalizeRoundedProbabilities(values: readonly number[]): number[] | null {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0 || Math.abs(sum - 1) > DECISION_PROBABILITY_SUM_TOLERANCE) return null;
  // Already exact (float noise only): leave the provider's bytes untouched.
  if (Math.abs(sum - 1) <= 1e-9) return [...values];
  return values.map(value => value / sum);
}
