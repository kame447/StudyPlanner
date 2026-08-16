import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningPendingQuestionV5 } from './weeklyPlanningPendingQuestionV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { shouldAttemptWeeklyPlanningContextualAnswerV5 } from './weeklyPlanningContextualAnswerRoutingV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: 'task-public',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '数学の問題集をやる',
      study: {
        purpose: 'practice',
        activityKind: 'problem_solving',
        contextLabel: null,
        components: [],
      },
      workloads: [],
      effortEstimates: [],
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

function pendingEffort(): WeeklyPlanningPendingQuestionV5 {
  return {
    actionId: null,
    questionCode: 'missing_effort_estimate',
    targetFactId: 'workload-public',
    graphRevision: 1,
    effortMeasurement: 'duration_per_unit',
  };
}

describe('Stable V5 contextual-answer routing', () => {
  it('attempts exact effort binding when the semantic document contains one duration answer', () => {
    const value = document();
    value.tasks[0].effortEstimates.push({
      localId: 'effort-1',
      targetLocalId: 'task-1',
      kind: 'total_duration',
      minutes: 5,
      unitCode: null,
      precision: 'approximate',
      sourceText: '5分くらい',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort(),
    })).toBe(true);
  });

  it('routes deadline and progress meaning through normal canonicalization while effort remains unanswered', () => {
    const value = document();
    value.tasks[0].temporalConstraints.push({
      localId: 'deadline-1',
      targetLocalId: 'task-1',
      kind: 'deadline',
      constraintLevel: 'hard',
      dateExpression: 'next_week',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      precision: 'unspecified',
      sourceText: 'これ来週まで',
    });
    value.uncertainties.push({
      localId: 'progress-1',
      targetLocalId: 'task-1',
      field: 'completed_amount',
      reason: '完了数は不明',
      sourceText: 'まだほぼやってない',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort(),
    })).toBe(false);
  });

  it('keeps an otherwise incompatible bare reply on the guarded contextual path', () => {
    const value = document();
    value.tasks[0].workloads.push({
      localId: 'wrong-workload',
      quantityRole: 'unknown',
      amount: 3,
      unitCode: 'page',
      unitLabel: 'ページ',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: '3ページです',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort(),
    })).toBe(true);
  });
});
