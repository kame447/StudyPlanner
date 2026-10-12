import { bufferedWeeklyPlanningEstimateMinutes } from './weeklyPlanningEffortAllocation';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';

export type WeeklyPlanningAllocationReason = 'calibration' | 'estimate_margin' | 'rounding';

export interface WeeklyPlanningAllocationBreakdown {
  estimatedMinutes: number;
  calibratedMinutes: number;
  bufferedMinutes: number;
  allocatedMinutes: number;
  marginMinutes: number;
  reasons: WeeklyPlanningAllocationReason[];
}

const EPSILON = 1e-7;
const clean = (minutes: number) => Math.round(minutes * 1e9) / 1e9;

/** The same closed display-evidence envelope is accepted from placement and saved state. */
export function isWeeklyPlanningAllocationBreakdown(value: unknown): value is WeeklyPlanningAllocationBreakdown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const numbers = ['estimatedMinutes', 'calibratedMinutes', 'bufferedMinutes', 'allocatedMinutes', 'marginMinutes'];
  return Object.keys(record).every((key) => [...numbers, 'reasons'].includes(key))
    && numbers.every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]) && (record[key] as number) >= 0)
    && Array.isArray(record.reasons)
    && record.reasons.every((reason) => ['calibration', 'estimate_margin', 'rounding'].includes(reason))
    && Math.abs((record.marginMinutes as number) - Math.max(0,
      (record.allocatedMinutes as number) - (record.estimatedMinutes as number))) <= EPSILON;
}

/** Project an already allocated work target into its placed slice, without allocating again. */
export function allocationBreakdownForWeeklyPlanningWorkItem(
  item: GenericPlanningWorkItem,
  allocatedMinutes: number,
): WeeklyPlanningAllocationBreakdown | undefined {
  const base = item.baseEstimatedMinutes;
  const total = item.estimatedMinutes;
  if (base == null || total == null || item.estimateBasis === null
    || ![base, total, allocatedMinutes].every((value) => Number.isFinite(value) && value > 0)) {
    return undefined;
  }
  const ratio = allocatedMinutes / total;
  const calibration = item.calibrationMultiplier ?? 1;
  const multiplier = Number.isFinite(calibration) && calibration > 0 ? calibration : 1;
  const estimatedMinutes = clean(base * ratio);
  const calibratedMinutes = clean(base * multiplier * ratio);
  const bufferedMinutes = clean(bufferedWeeklyPlanningEstimateMinutes({
    baseEstimateMinutes: base,
    calibrationMultiplier: multiplier,
    safetyBufferMultiplier: item.estimateBasis === 'intrinsic_duration' ? 1 : undefined,
  }) * ratio);
  const reasons: WeeklyPlanningAllocationReason[] = [];
  if (Math.abs(calibratedMinutes - estimatedMinutes) > EPSILON) reasons.push('calibration');
  if (bufferedMinutes - calibratedMinutes > EPSILON) reasons.push('estimate_margin');
  if (allocatedMinutes - bufferedMinutes > EPSILON) reasons.push('rounding');
  return {
    estimatedMinutes,
    calibratedMinutes,
    bufferedMinutes,
    allocatedMinutes,
    marginMinutes: clean(Math.max(0, allocatedMinutes - estimatedMinutes)),
    reasons,
  };
}

export interface WeeklyPlanningAllocatedCandidate {
  durationMinutes: number;
  allocationBreakdown?: WeeklyPlanningAllocationBreakdown;
}

/** Sum actual output candidates; missing or stale evidence cannot become a whole-preview claim. */
export function summarizeWeeklyPlanningAllocationBreakdown(
  candidates: readonly WeeklyPlanningAllocatedCandidate[],
): WeeklyPlanningAllocationBreakdown | null {
  if (candidates.length === 0) return null;
  const summary: WeeklyPlanningAllocationBreakdown = {
    estimatedMinutes: 0, calibratedMinutes: 0, bufferedMinutes: 0,
    allocatedMinutes: 0, marginMinutes: 0, reasons: [],
  };
  for (const candidate of candidates) {
    const value = candidate.allocationBreakdown;
    if (!isWeeklyPlanningAllocationBreakdown(value)
      || !Number.isFinite(candidate.durationMinutes) || candidate.durationMinutes <= 0
      || Math.abs(value.allocatedMinutes - candidate.durationMinutes) > EPSILON) return null;
    summary.estimatedMinutes += value.estimatedMinutes;
    summary.calibratedMinutes += value.calibratedMinutes;
    summary.bufferedMinutes += value.bufferedMinutes;
    summary.allocatedMinutes += value.allocatedMinutes;
    summary.reasons = [...new Set([...summary.reasons, ...value.reasons])];
  }
  return {
    ...summary,
    estimatedMinutes: clean(summary.estimatedMinutes),
    calibratedMinutes: clean(summary.calibratedMinutes),
    bufferedMinutes: clean(summary.bufferedMinutes),
    allocatedMinutes: clean(summary.allocatedMinutes),
    marginMinutes: clean(Math.max(0, summary.allocatedMinutes - summary.estimatedMinutes)),
  };
}
