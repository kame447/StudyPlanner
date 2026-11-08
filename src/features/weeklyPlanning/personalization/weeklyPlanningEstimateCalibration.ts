import type { Actual, Plan } from '../../../types/domain';
import type { GenericPlanningWorkItem } from '../semantic/weeklyPlanningGenericWorkItems';
import { getActualDurationMinutes, isDurationActual } from '../../../lib/actualDuration';

export const WEEKLY_PLANNING_ESTIMATE_METADATA_VERSION = 1 as const;
export const WEEKLY_PLANNING_ESTIMATE_CALIBRATION_VERSION =
  'weekly-planning-estimate-calibration-v1' as const;

export interface WeeklyPlanningEstimateMetadataV1 {
  version: typeof WEEKLY_PLANNING_ESTIMATE_METADATA_VERSION;
  baseEstimateMinutes: number;
  estimateBasis: GenericPlanningWorkItem['estimateBasis'];
  calibrationMultiplier: number;
  allocationMinutes: number;
  roundingStepMinutes: 5 | 15;
  sourceFactRefs: string[];
}

export interface WeeklyPlanningEstimateCalibration {
  version: typeof WEEKLY_PLANNING_ESTIMATE_CALIBRATION_VERSION;
  multiplier: number;
  observationCount: number;
  medianRatio: number | null;
  /** Sum of the observation weights (equals observationCount when no `asOfDate` is given). */
  effectiveObservationCount: number;
}

/**
 * Observations lose half their weight every 8 weeks. There is no measured data yet to fit this; 8 weeks is
 * deliberately slow (an observation still weighs 25% after 16 weeks), because a wrong fast decay would
 * throw away the few observations a new user has. It still makes year-old observations negligible (about 1%). Revisit once production observations exist.
 */
export const WEEKLY_PLANNING_ESTIMATE_OBSERVATION_HALF_LIFE_DAYS = 56;

type PlanWithEstimateMetadata = Plan & {
  weeklyPlanningEstimate?: WeeklyPlanningEstimateMetadataV1;
};

function timeToMinutes(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function actualDurationMinutes(actual: Actual): number | null {
  if (isDurationActual(actual)) return getActualDurationMinutes(actual) || null;
  const start = timeToMinutes(actual.actualStartTime);
  const end = timeToMinutes(actual.actualEndTime);
  if (start === null || end === null) return null;
  const duration = end >= start ? end - start : (24 * 60 - start) + end;
  return duration > 0 ? duration : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Weighted median; with equal weights it is the ordinary median (the mean of the two middle values when even). */
function weightedMedian(values: { value: number; weight: number }[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left.value - right.value);
  const half = sorted.reduce((sum, item) => sum + item.weight, 0) / 2;
  const epsilon = 1e-9;
  let cumulative = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    cumulative += sorted[index].weight;
    if (Math.abs(cumulative - half) <= epsilon && index + 1 < sorted.length) {
      return (sorted[index].value + sorted[index + 1].value) / 2;
    }
    if (cumulative > half) return sorted[index].value;
  }
  return sorted[sorted.length - 1].value;
}

function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

/** 1 for today or a future date, halving every half-life. An unreadable date or no `asOfDate` keeps full weight. */
function observationWeight(occurrenceDate: string, asOfDate: string | undefined): number {
  if (!asOfDate) return 1;
  const observed = dayNumber(occurrenceDate);
  const now = dayNumber(asOfDate);
  if (observed === null || now === null || observed >= now) return 1;
  return 0.5 ** ((now - observed) / WEEKLY_PLANNING_ESTIMATE_OBSERVATION_HALF_LIFE_DAYS);
}

export function createWeeklyPlanningEstimateMetadata(
  item: GenericPlanningWorkItem,
  allocationMinutes: number,
): WeeklyPlanningEstimateMetadataV1 | null {
  // Only a user's own effort estimate is something an actual can be compared with. A time the user chose
  // to spend (intrinsic duration or a provisional timebox) is not an estimate, and an observed pace is
  // already built from actuals.
  if (item.estimateBasis !== 'direct_effort') return null;
  const itemBaseMinutes = item.baseEstimatedMinutes ?? item.estimatedMinutes;
  // A work item can be placed as several blocks. Each block records its own share of the base, in the
  // same proportion as its allocation (as the allocation breakdown does); the whole base on every block
  // would make a later actual/base ratio look too small.
  const baseEstimateMinutes = itemBaseMinutes !== null && item.estimatedMinutes !== null && item.estimatedMinutes > 0
    && allocationMinutes > 0 && allocationMinutes <= item.estimatedMinutes
    ? itemBaseMinutes * (allocationMinutes / item.estimatedMinutes)
    : itemBaseMinutes;
  const roundingStepMinutes = item.roundingStepMinutes;
  if (
    baseEstimateMinutes === null
    || !Number.isFinite(baseEstimateMinutes)
    || baseEstimateMinutes <= 0
    || (roundingStepMinutes !== 5 && roundingStepMinutes !== 15)
  ) {
    return null;
  }
  return {
    version: WEEKLY_PLANNING_ESTIMATE_METADATA_VERSION,
    baseEstimateMinutes,
    estimateBasis: item.estimateBasis,
    calibrationMultiplier: item.calibrationMultiplier ?? 1,
    allocationMinutes,
    roundingStepMinutes,
    sourceFactRefs: [...item.sourceFactRefs],
  };
}

/**
 * The three numbers a placed candidate keeps (candidates are stored in size-bounded traces and
 * checkpoints). Everything else in the metadata is already on the candidate or fixed by the recording rule.
 */
export interface WeeklyPlanningCandidateEstimateV1 {
  base: number;
  multiplier: number;
  step: 5 | 15;
}

export function createWeeklyPlanningCandidateEstimate(
  item: GenericPlanningWorkItem,
  allocationMinutes: number,
): WeeklyPlanningCandidateEstimateV1 | null {
  const metadata = createWeeklyPlanningEstimateMetadata(item, allocationMinutes);
  return metadata
    ? { base: metadata.baseEstimateMinutes, multiplier: metadata.calibrationMultiplier, step: metadata.roundingStepMinutes }
    : null;
}

/** The inverse of the compact form; only a direct effort estimate is ever recorded (see the factory). */
export function expandWeeklyPlanningCandidateEstimate(
  estimate: WeeklyPlanningCandidateEstimateV1,
  block: { allocationMinutes: number; sourceFactRefs: readonly string[] },
): WeeklyPlanningEstimateMetadataV1 {
  return {
    version: WEEKLY_PLANNING_ESTIMATE_METADATA_VERSION,
    baseEstimateMinutes: estimate.base,
    estimateBasis: 'direct_effort',
    calibrationMultiplier: estimate.multiplier,
    allocationMinutes: block.allocationMinutes,
    roundingStepMinutes: estimate.step,
    sourceFactRefs: [...block.sourceFactRefs],
  };
}

export function readWeeklyPlanningEstimateMetadata(
  plan: Plan,
): WeeklyPlanningEstimateMetadataV1 | null {
  const value = (plan as PlanWithEstimateMetadata).weeklyPlanningEstimate;
  if (!value || value.version !== WEEKLY_PLANNING_ESTIMATE_METADATA_VERSION) return null;
  if (
    !Number.isFinite(value.baseEstimateMinutes)
    || value.baseEstimateMinutes <= 0
    || !Number.isFinite(value.calibrationMultiplier)
    || value.calibrationMultiplier <= 0
    || !Number.isFinite(value.allocationMinutes)
    || value.allocationMinutes <= 0
    || (value.roundingStepMinutes !== 5 && value.roundingStepMinutes !== 15)
    || !Array.isArray(value.sourceFactRefs)
    || !value.sourceFactRefs.every((ref) => typeof ref === 'string' && ref.trim().length > 0)
  ) {
    return null;
  }
  return {
    ...value,
    sourceFactRefs: [...value.sourceFactRefs],
  };
}

export function deriveWeeklyPlanningEstimateCalibration(params: {
  plans: readonly Plan[];
  actuals: readonly Actual[];
  /** YYYY-MM-DD "today"; older observations weigh less. Omitted: every observation weighs 1. */
  asOfDate?: string;
}): WeeklyPlanningEstimateCalibration {
  const planById = new Map(params.plans.map((plan) => [plan.id, plan]));
  const ratios = params.actuals.flatMap((actual) => {
    // An actual the user marked "different from the plan" is not an observation of that plan's estimate,
    // even though it keeps the planId (the pace observations already exclude it the same way).
    // A one-tap completion keeps the plan's own times; it is not a measured duration.
    if (!actual.planId || actual.isAlignedToPlan === false || actual.timesFromPlan) return [];
    const plan = planById.get(actual.planId);
    if (!plan) return [];
    const metadata = readWeeklyPlanningEstimateMetadata(plan);
    const actualMinutes = actualDurationMinutes(actual);
    if (!metadata || actualMinutes === null) return [];
    return [{
      value: clamp(actualMinutes / metadata.baseEstimateMinutes, 0.5, 2),
      weight: observationWeight(actual.occurrenceDate, params.asOfDate),
    }];
  });
  const medianRatio = weightedMedian(ratios);
  if (medianRatio === null) {
    return {
      version: WEEKLY_PLANNING_ESTIMATE_CALIBRATION_VERSION,
      multiplier: 1,
      observationCount: 0,
      medianRatio: null,
      effectiveObservationCount: 0,
    };
  }

  // Decay lowers the effective count, so the existing shrinkage n/(n+3) pulls stale evidence back toward 1
  // (all observations very old: effective count -> 0, multiplier -> 1). The 0.75..1.75 clamp is unchanged.
  const effectiveCount = ratios.reduce((sum, item) => sum + item.weight, 0);
  const evidenceWeight = effectiveCount / (effectiveCount + 3);
  const multiplier = clamp(1 + (medianRatio - 1) * evidenceWeight, 0.75, 1.75);
  return {
    version: WEEKLY_PLANNING_ESTIMATE_CALIBRATION_VERSION,
    multiplier,
    observationCount: ratios.length,
    medianRatio,
    effectiveObservationCount: effectiveCount,
  };
}
