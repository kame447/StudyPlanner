import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningEffortQuestionPlanV5,
} from './weeklyPlanningEffortQuestionPolicyV5';

describe('Stable V5 human-scale effort question policy', () => {
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

  it('uses completed workload evidence as a total duration', () => {
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

  it('never asks a future qualitative custom scope for its unknowable total duration', () => {
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: 1,
      unitCode: 'custom',
      unitLabel: '分野（理論化学）',
      quantityRole: 'target',
    })).toEqual({
      kind: 'session_duration',
      unitCode: 'custom',
      sessionQuantities: [],
    });
  });

  it('does not infer a one-session policy from vocabulary units or word-count thresholds', () => {
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
