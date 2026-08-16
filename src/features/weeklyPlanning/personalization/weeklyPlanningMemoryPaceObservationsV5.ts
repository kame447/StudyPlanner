import type {
  Actual,
  Plan,
  WeeklyPlanningMemoryPaceObservationResultV1,
  WeeklyPlanningMemoryPaceObservationSourceV1,
} from '../../../types/domain';

export interface WeeklyPlanningMemoryPaceObservationV5 {
  planId: string;
  actualId: string;
  occurrenceDate: string;
  actualMinutes: number;
  progressAmount: number;
  unitCode: string;
  unitLabel: string;
  progressPerMinute: number;
  minutesPerUnit: number;
}

export interface WeeklyPlanningMemoryPaceEstimateV5 {
  unitCode: string;
  observationCount: number;
  medianProgressPerMinute: number | null;
  medianMinutesPerUnit: number | null;
  medianSessionMinutes: number | null;
}

function timeToMinutes(value: string): number | null {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function actualDurationMinutes(actual: Actual): number | null {
  const start = timeToMinutes(actual.actualStartTime);
  const end = timeToMinutes(actual.actualEndTime);
  if (start === null || end === null) return null;
  const duration = end >= start ? end - start : 24 * 60 - start + end;
  return duration > 0 ? duration : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function validateWeeklyPlanningMemoryPaceObservationResultV5(params: {
  source: WeeklyPlanningMemoryPaceObservationSourceV1;
  result: WeeklyPlanningMemoryPaceObservationResultV1 | undefined;
}): 'missing' | 'invalid_amount' | 'unit_mismatch' | null {
  const result = params.result;
  if (!result) return 'missing';
  if (
    result.version !== 1
    || result.kind !== 'memory_pace_calibration'
    || !Number.isFinite(result.progressAmount)
    || result.progressAmount < 0
    || result.progressAmount > params.source.targetAmount
  ) return 'invalid_amount';
  if (
    result.unitCode !== params.source.unitCode
    || result.unitLabel !== params.source.unitLabel
  ) return 'unit_mismatch';
  return null;
}

export function createWeeklyPlanningMemoryPaceObservationResultV5(params: {
  source: WeeklyPlanningMemoryPaceObservationSourceV1;
  progressAmount: number;
}): WeeklyPlanningMemoryPaceObservationResultV1 | null {
  const result: WeeklyPlanningMemoryPaceObservationResultV1 = {
    version: 1,
    kind: 'memory_pace_calibration',
    progressAmount: params.progressAmount,
    unitCode: params.source.unitCode,
    unitLabel: params.source.unitLabel,
  };
  return validateWeeklyPlanningMemoryPaceObservationResultV5({
    source: params.source,
    result,
  }) === null
    ? result
    : null;
}

export function collectWeeklyPlanningMemoryPaceObservationsV5(params: {
  plans: readonly Plan[];
  actuals: readonly Actual[];
}): WeeklyPlanningMemoryPaceObservationV5[] {
  const planById = new Map(params.plans.map((plan) => [plan.id, plan]));
  return params.actuals.flatMap((actual) => {
    if (!actual.planId || actual.isAlignedToPlan === false) return [];
    const plan = planById.get(actual.planId);
    const source = plan?.weeklyPlanningObservationSource;
    const result = actual.weeklyPlanningObservationResult;
    if (!plan || !source || source.kind !== 'memory_pace_calibration') return [];
    if (validateWeeklyPlanningMemoryPaceObservationResultV5({ source, result }) !== null) {
      return [];
    }
    const actualMinutes = actualDurationMinutes(actual);
    if (actualMinutes === null || !result || result.progressAmount <= 0) return [];
    return [{
      planId: plan.id,
      actualId: actual.id,
      occurrenceDate: actual.occurrenceDate,
      actualMinutes,
      progressAmount: result.progressAmount,
      unitCode: result.unitCode,
      unitLabel: result.unitLabel,
      progressPerMinute: result.progressAmount / actualMinutes,
      minutesPerUnit: actualMinutes / result.progressAmount,
    }];
  });
}

export function deriveWeeklyPlanningMemoryPaceEstimateV5(params: {
  plans: readonly Plan[];
  actuals: readonly Actual[];
  unitCode: string;
}): WeeklyPlanningMemoryPaceEstimateV5 {
  const observations = collectWeeklyPlanningMemoryPaceObservationsV5(params)
    .filter((observation) => observation.unitCode === params.unitCode);
  return {
    unitCode: params.unitCode,
    observationCount: observations.length,
    medianProgressPerMinute: median(observations.map((item) => item.progressPerMinute)),
    medianMinutesPerUnit: median(observations.map((item) => item.minutesPerUnit)),
    medianSessionMinutes: median(observations.map((item) => item.actualMinutes)),
  };
}
