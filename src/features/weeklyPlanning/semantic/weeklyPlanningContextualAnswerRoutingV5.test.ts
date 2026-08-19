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

function pendingEffort(
  effortMeasurement: WeeklyPlanningPendingQuestionV5['effortMeasurement'] = 'duration_per_unit',
): WeeklyPlanningPendingQuestionV5 {
  return {
    actionId: null,
    questionCode: 'missing_effort_estimate',
    targetFactId: 'workload-public',
    graphRevision: 1,
    effortMeasurement,
  };
}

function observedPacePending(): WeeklyPlanningPendingQuestionV5 {
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

describe('Stable V5 contextual-answer routing', () => {
  it('attempts exact effort binding when the semantic measurement matches the pending question', () => {
    const value = document();
    value.tasks[0].effortEstimates.push({
      localId: 'effort-1',
      targetLocalId: 'task-1',
      kind: 'duration_per_unit',
      minutes: 5,
      unitCode: 'problem',
      precision: 'approximate',
      sourceText: '1問5分くらい',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort('duration_per_unit'),
    })).toBe(true);
  });

  it('keeps a temporary answer task shell on the guarded contextual path', () => {
    const value = document();
    delete value.tasks[0].existingPublicId;
    value.tasks[0].effortEstimates.push({
      localId: 'effort-1',
      targetLocalId: 'task-1',
      kind: 'total_duration',
      minutes: 30,
      unitCode: null,
      precision: 'approximate',
      sourceText: '30分くらい',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort('total_duration'),
    })).toBe(true);
  });

  it('keeps a new target-only task as an independent semantic delta', () => {
    const value = document();
    delete value.tasks[0].existingPublicId;
    value.tasks[0].workloads.push({
      localId: 'new-target',
      quantityRole: 'target',
      amount: 20,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: '別の問題を20問',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort('total_duration'),
    })).toBe(false);
  });

  it('keeps an explicit per-unit alternate measurement on the exact contextual target', () => {
    const value = document();
    value.tasks[0].effortEstimates.push({
      localId: 'effort-1',
      targetLocalId: 'task-1',
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'page',
      precision: 'approximate',
      sourceText: '1枚あたり8分くらい',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort('total_duration'),
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

  it('does not drop an independent deadline when the same turn also answers effort', () => {
    const value = document();
    value.tasks[0].effortEstimates.push({
      localId: 'effort-1',
      targetLocalId: 'task-1',
      kind: 'total_duration',
      minutes: 30,
      unitCode: null,
      precision: 'approximate',
      sourceText: '30分くらい',
    });
    value.tasks[0].temporalConstraints.push({
      localId: 'deadline-1',
      targetLocalId: 'task-1',
      kind: 'deadline',
      constraintLevel: 'hard',
      dateExpression: 'tomorrow',
      namedTimePeriod: null,
      startTime: null,
      endTime: '13:00',
      precision: 'exact',
      sourceText: '締切は明日13時',
    });

    expect(shouldAttemptWeeklyPlanningContextualAnswerV5({
      document: value,
      pendingQuestion: pendingEffort('total_duration'),
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

  it('binds remaining total duration to the schedulable estimate target instead of completed evidence', () => {
    const value = document();
    value.tasks[0].workloads.push({
      localId: 'semantic-remaining',
      quantityRole: 'remaining',
      amount: 30,
      unitCode: 'custom',
      unitLabel: '%',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: '残り30%',
    });
    value.tasks[0].effortEstimates.push({
      localId: 'effort-remaining',
      targetLocalId: 'semantic-remaining',
      kind: 'total_duration',
      minutes: 45,
      unitCode: null,
      precision: 'approximate',
      sourceText: '残りは45分くらい',
    });

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: observedPacePending(),
    })).toBe('remaining-30');
  });

  it('binds explicit per-unit alternate effort to the schedulable estimate target', () => {
    const value = document();
    value.tasks[0].effortEstimates.push({
      localId: 'effort-per-page',
      targetLocalId: 'task-1',
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'page',
      precision: 'approximate',
      sourceText: '1枚あたり8分くらい',
    });

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: observedPacePending(),
    })).toBe('remaining-30');
  });

  it('does not activate the estimate target without the completed-work question basis', () => {
    const value = document();
    value.tasks[0].effortEstimates.push({
      localId: 'effort-per-page',
      targetLocalId: 'task-1',
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'page',
      precision: 'approximate',
      sourceText: '1枚あたり8分くらい',
    });
    const pending = observedPacePending();
    pending.questionBasis = null;

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: pending,
    })).toBe('completed-70');
  });

  it('keeps direct historical total duration on the completed evidence target', () => {
    const value = document();
    value.tasks[0].workloads.push({
      localId: 'semantic-completed',
      quantityRole: 'completed',
      amount: 70,
      unitCode: 'custom',
      unitLabel: '%',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: '完了70%',
    });
    value.tasks[0].effortEstimates.push({
      localId: 'effort-completed',
      targetLocalId: 'semantic-completed',
      kind: 'total_duration',
      minutes: 90,
      unitCode: null,
      precision: 'approximate',
      sourceText: 'ここまでは90分くらい',
    });

    expect(contextualAnswerTargetFactIdV5({
      document: value,
      pendingQuestion: observedPacePending(),
    })).toBe('completed-70');
  });
});
