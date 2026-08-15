export interface WeeklyPlanningEffortQuestionWorkloadV5 {
  amount: number;
  unitCode: string;
  unitLabel: string;
  quantityRole?: 'declared' | 'target' | 'remaining' | 'completed' | 'unknown';
}

export interface WeeklyPlanningEffortQuestionPlanV5 {
  kind: 'total_duration' | 'duration_per_unit' | 'session_duration';
  unitCode: string | null;
  sessionQuantities: number[];
}

/**
 * Historical compatibility facade. Vocabulary quantity is scope/progress, not a
 * session-size rule, so this helper no longer invents word-count-based batches.
 */
export function splitVocabularyIntoLearningSessionsV5(
  totalWords: number,
): number[] {
  if (!Number.isInteger(totalWords) || totalWords <= 0) return [];
  return [totalWords];
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

  if (workload.unitCode === 'word') {
    return {
      kind: 'total_duration',
      unitCode: null,
      sessionQuantities: [],
    };
  }

  return {
    kind: 'total_duration',
    unitCode: null,
    sessionQuantities: [],
  };
}
