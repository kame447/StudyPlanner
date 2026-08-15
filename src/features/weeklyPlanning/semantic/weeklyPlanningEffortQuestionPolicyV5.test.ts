import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningEffortQuestionPlanV5,
  splitVocabularyIntoLearningSessionsV5,
} from './weeklyPlanningEffortQuestionPolicyV5';

describe('Stable V5 human-scale effort question policy', () => {
  it('does not invent vocabulary session batches from word count alone', () => {
    expect(splitVocabularyIntoLearningSessionsV5(80)).toEqual([80]);
    expect(splitVocabularyIntoLearningSessionsV5(100)).toEqual([100]);
    expect(splitVocabularyIntoLearningSessionsV5(101)).toEqual([101]);
    expect(splitVocabularyIntoLearningSessionsV5(220)).toEqual([220]);
    expect(splitVocabularyIntoLearningSessionsV5(1_000)).toEqual([1_000]);
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

  it('asks vocabulary total effort regardless of an arbitrary word-count boundary', () => {
    for (const amount of [80, 99, 100, 101, 220]) {
      expect(createWeeklyPlanningEffortQuestionPlanV5({
        amount,
        unitCode: 'word',
        unitLabel: '語',
      })).toEqual({
        kind: 'total_duration',
        unitCode: null,
        sessionQuantities: [],
      });
    }
  });
});
