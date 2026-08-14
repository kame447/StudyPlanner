export const WEEKLY_PLANNING_VOCABULARY_SESSION_MAX_WORDS_V5 = 100;

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

function balancedIntegerSplit(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) =>
    base + (index >= count - remainder ? 1 : 0));
}

export function splitVocabularyIntoLearningSessionsV5(
  totalWords: number,
): number[] {
  if (!Number.isInteger(totalWords) || totalWords <= 0) return [];
  const sessionCount = Math.ceil(
    totalWords / WEEKLY_PLANNING_VOCABULARY_SESSION_MAX_WORDS_V5,
  );
  if (sessionCount <= 1) return [totalWords];
  if (totalWords % sessionCount === 0) {
    return Array(sessionCount).fill(totalWords / sessionCount);
  }

  const average = totalWords / sessionCount;
  const cleanBase = Math.floor(average / 10) * 10;
  let remaining = totalWords - cleanBase * sessionCount;
  if (cleanBase <= 0 || remaining < 10) {
    return balancedIntegerSplit(totalWords, sessionCount);
  }

  const sessions = Array(sessionCount).fill(cleanBase);
  for (let index = sessionCount - 1; index >= 0 && remaining >= 10; index -= 1) {
    const capacity = WEEKLY_PLANNING_VOCABULARY_SESSION_MAX_WORDS_V5 - sessions[index];
    if (capacity < 10) continue;
    sessions[index] += 10;
    remaining -= 10;
  }

  while (remaining > 0) {
    let targetIndex = -1;
    let targetValue = Number.POSITIVE_INFINITY;
    for (let index = 0; index < sessions.length; index += 1) {
      if (
        sessions[index] < WEEKLY_PLANNING_VOCABULARY_SESSION_MAX_WORDS_V5
        && sessions[index] < targetValue
      ) {
        targetIndex = index;
        targetValue = sessions[index];
      }
    }
    if (targetIndex < 0) return balancedIntegerSplit(totalWords, sessionCount);
    sessions[targetIndex] += 1;
    remaining -= 1;
  }

  return sessions.sort((left, right) => left - right);
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
    const sessionQuantities = splitVocabularyIntoLearningSessionsV5(workload.amount);
    if (sessionQuantities.length > 1) {
      return {
        kind: 'session_duration',
        unitCode: 'word',
        sessionQuantities,
      };
    }
    return {
      kind: 'total_duration',
      unitCode: null,
      sessionQuantities,
    };
  }

  return {
    kind: 'total_duration',
    unitCode: null,
    sessionQuantities: [],
  };
}
