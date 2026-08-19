import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningPendingQuestionV5 } from './weeklyPlanningPendingQuestionV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  contextualAnswerTargetFactIdV5,
  shouldAttemptWeeklyPlanningContextualAnswerV5,
} from './weeklyPlanningContextualAnswerRoutingV5';

function pendingQuestion(): WeeklyPlanningPendingQuestionV5 {
  return {
    actionId: null,
    questionCode: 'missing_effort_estimate',
    targetFactId: 'completed-70',
    graphRevision: 4,
    effortMeasurement: 'total_duration',
    estimateForWorkloadFactId: 'remaining-30',
    questionBasis: 'completed_workload_total',
  };
}

function document(params: {
  effortTargetLocalId: string;
  workloadRole?: 'completed' | 'remaining';
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-shell',
      existingPublicId: 'task-public',
      decompositionStatus: 'atomic',
      category: 'study',
      title: 'レポート',
      study: null,
      workloads: params.workloadRole
        ? [{
            localId: params.effortTargetLocalId,
            quantityRole: params.workloadRole,
            amount: params.workloadRole === 'completed' ? 70 : 30,
            unitCode: 'custom',
            unitLabel: '%',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '現在ターン',
          }]
        : [],
      effortEstimates: [{
        localId: 'effort-1',
        targetLocalId: params.effortTargetLocalId,
        kind: 'total_duration',
        minutes: 45,
        unitCode: null,
        precision: 'approximate',
        sourceText: '現在ターン',
      }],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '現在ターン',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 dual-target generic fallback safety', () => {
  it('does not default a directionless task-shell total duration to completed evidence', () => {
    const value = document({ effortTargetLocalId: 'task-shell' });
    const pending = pendingQuestion();

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: pending,
    })).toBeNull();
    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pending,
    })).toBe(false);
  });

  it('keeps an explicitly remaining total duration on the schedulable target', () => {
    const value = document({
      effortTargetLocalId: 'semantic-remaining',
      workloadRole: 'remaining',
    });
    const pending = pendingQuestion();

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: pending,
    })).toBe('remaining-30');
    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pending,
    })).toBe(true);
  });

  it('keeps an explicitly completed total duration on the question target', () => {
    const value = document({
      effortTargetLocalId: 'semantic-completed',
      workloadRole: 'completed',
    });
    const pending = pendingQuestion();

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: pending,
    })).toBe('completed-70');
    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pending,
    })).toBe(true);
  });
});
