/** JSON-wire value equality: object keys are unordered, array entries and exact values are not.
 * Callers own validation and domain-specific field selection; this does not define canonical hash bytes.
 */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalValue(record[key])]),
  );
}

export function areWeeklyPlanningJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}
