import { CLOCK_UNIT_RATE_PROJECTED_PREFIX } from './weeklyPlanningExistingWorkloadRateReferenceV5';

/**
 * Typed fact: the turn used a per-unit rate the model typed with a clock unitCode as minutes per counted unit
 * (x8 projection). The application states it, once, so the interpretation is visible and correctable.
 */
export interface RateUnitProjectedV5 {
  /** The user's own grounded words of the rate. */
  quote: string;
  minutes: number;
  /** The counted unit of the target workload, from its typed unit. */
  unitLabel: string;
}

/** The first projection recorded for the turn (a repeated attempt records it again; one sentence per turn). */
export function rateUnitProjectedFromRepairsV5(repairs: readonly string[] | undefined): RateUnitProjectedV5 | null {
  for (const repair of repairs ?? []) {
    if (!repair.startsWith(CLOCK_UNIT_RATE_PROJECTED_PREFIX)) continue;
    try {
      const [, , , , quote, minutes, unitLabel] = JSON.parse(repair.slice(CLOCK_UNIT_RATE_PROJECTED_PREFIX.length)) as unknown[];
      if (typeof quote === 'string' && typeof minutes === 'number' && typeof unitLabel === 'string') return { quote, minutes, unitLabel };
    } catch { /* a malformed diagnostic states nothing */ }
  }
  return null;
}
