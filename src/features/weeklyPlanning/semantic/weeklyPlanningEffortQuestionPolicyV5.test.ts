import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningEffortQuestionPlanV5,
  splitVocabularyIntoLearningSessionsV5,
} from './weeklyPlanningEffortQuestionPolicyV5';

describe('Stable V5 human-scale effort question policy', () => {
  it('splits vocabulary into balanced sessions with a hard 100-word ceiling', () => {
    expect(splitVocabularyIntoLearningSessionsV5(80)).toEqual([80]);
    expect(splitVocabularyIntoLearningSessionsV5(120)).toEqual([60, 60]);
    expect(splitVocabularyIntoLearningSessionsV5(140)).toEqual([70, 70]);
    expect(splitVocabularyIntoLearningSessionsV5(150)).toEqual([75, 75]);
    expect(splitVocabularyIntoLearningSessionsV5(160)).toEqual([80, 80]);
    expect(splitVocabularyIntoLearningSessionsV5(170)).toEqual([85, 85]);
    expect(splitVocabularyIntoLearningSessionsV5(180)).toEqual([90, 90]);
    expect(splitVocabularyIntoLearningSessionsV5(190)).toEqual([95, 95]);
    expect(splitVocabularyIntoLearningSessionsV5(200)).toEqual([100, 100]);
    expect(splitVocabularyIntoLearningSessionsV5(220)).toEqual([70, 70, 80]);
    expect(splitVocabularyIntoLearningSessionsV5(250)).toEqual([80, 80, 90]);
    expect(splitVocabularyIntoLearningSessionsV5(299)).toEqual([99, 100, 100]);
  });

  it('preserves the exact total while keeping every vocabulary session at or below 100 words', () => {
    for (let total = 1; total <= 1_000; total += 1) {
      const sessions = splitVocabularyIntoLearningSessionsV5(total);
      expect(sessions.reduce((sum, value) => sum + value, 0)).toBe(total);
      expect(Math.max(...sessions)).toBeLessThanOrEqual(100);
      expect(Math.min(...sessions)).toBeGreaterThan(0);
      expect(sessions).toHaveLength(Math.ceil(total / 100));
    }
  });

  it('asks page and problem workloads per unit instead of asking for a coarse total', () => {
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: 30,
      unitCode: 'page',
      unitLabel: 'ページ',
    })).toEqual({
      kind: 'duration_per_unit',
      unitCode: 'page',
      sessionQuantities: [],
    });
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: 80,
      unitCode: 'problem',
      unitLabel: '問',
    })).toEqual({
      kind: 'duration_per_unit',
      unitCode: 'problem',
      sessionQuantities: [],
    });
  });

  it('asks for completed workload evidence as a total duration', () => {
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: 30,
      unitCode: 'page',
      unitLabel: 'ページ',
      quantityRole: 'completed',
    })).toEqual({
      kind: 'total_duration',
      unitCode: null,
      sessionQuantities: [],
    });
  });

  it('asks small vocabulary as one batch and large vocabulary by learning session', () => {
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: 80,
      unitCode: 'word',
      unitLabel: '語',
    })).toEqual({
      kind: 'total_duration',
      unitCode: null,
      sessionQuantities: [80],
    });
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
    })).toEqual({
      kind: 'session_duration',
      unitCode: 'word',
      sessionQuantities: [70, 70, 80],
    });
  });
});
