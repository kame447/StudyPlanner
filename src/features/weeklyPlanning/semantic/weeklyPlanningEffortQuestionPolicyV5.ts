export type WeeklyPlanningEffortMeasurementV5 =
  | 'total_duration'
  | 'duration_per_unit'
  | 'session_duration';

export interface WeeklyPlanningEffortQuestionWorkloadV5 {
  amount: number;
  unitCode: string;
  unitLabel: string;
  quantityRole?: 'declared' | 'target' | 'remaining' | 'completed' | 'unknown';
}

export interface WeeklyPlanningEffortQuestionPlanV5 {
  kind: WeeklyPlanningEffortMeasurementV5;
  unitCode: string | null;
  sessionQuantities: number[];
}

export function isWeeklyPlanningEffortMeasurementV5(
  value: unknown,
): value is WeeklyPlanningEffortMeasurementV5 {
  return value === 'total_duration'
    || value === 'duration_per_unit'
    || value === 'session_duration';
}

export function createWeeklyPlanningEffortQuestionPlanV5(
  workload: WeeklyPlanningEffortQuestionWorkloadV5,
): WeeklyPlanningEffortQuestionPlanV5 {
  if (workload.quantityRole === 'completed') {
    return {
      kind: 'total_duration',
      unitCode: null,
      sessionQuantities: [],
    };
  }

  if (workload.unitCode === 'page' || workload.unitCode === 'problem') {
    return {
      kind: 'duration_per_unit',
      unitCode: workload.unitCode,
      sessionQuantities: [],
    };
  }

  if (workload.unitCode === 'custom' && workload.quantityRole === 'target') {
    return {
      kind: 'session_duration',
      unitCode: workload.unitCode,
      sessionQuantities: [],
    };
  }

  return {
    kind: 'total_duration',
    unitCode: null,
    sessionQuantities: [],
  };
}
