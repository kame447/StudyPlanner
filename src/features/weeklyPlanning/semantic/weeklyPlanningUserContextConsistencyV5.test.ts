import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningUserContextConsistencyV5,
} from './weeklyPlanningUserContextConsistencyV5';

function documentWith(params: {
  deadlineSourceText?: string;
  deadlineDate?: string;
  eventSourceText?: string;
  eventDate?: string;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-prep',
      category: 'study',
      title: '試験準備',
      study: {
        purpose: 'exam',
        contextLabel: '試験',
        components: [],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: params.deadlineSourceText
        ? [{
            localId: 'deadline-1',
            targetLocalId: 'task-prep',
            kind: 'deadline',
            constraintLevel: 'hard',
            dateExpression: params.deadlineDate ?? 'custom:来月の金曜日',
            namedTimePeriod: null,
            startTime: null,
            endTime: null,
            precision: 'unspecified',
            sourceText: params.deadlineSourceText,
          }]
        : [],
      recurrence: [],
      sourceText: '試験準備を進めたい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [{
      localId: 'event-1',
      kind: 'goal_event',
      label: '試験',
      value: null,
      dateExpression: params.eventDate ?? 'custom:来月の金曜日',
      sourceText: params.eventSourceText ?? '来月の金曜日に試験がある',
    }],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 user context semantic consistency', () => {
  it('rejects one evidence span being used as both event occurrence and work deadline', () => {
    const sourceText = '来月の金曜日に試験がある';
    expect(validateWeeklyPlanningUserContextConsistencyV5(documentWith({
      deadlineSourceText: sourceText,
      eventSourceText: sourceText,
    }))).toEqual([
      'document.tasks[0].temporalConstraints[0]:goal-event-and-work-deadline-share-evidence:keep-goal-event-and-remove-work-deadline-unless-distinct-explicit-completion-evidence-exists',
    ]);
  });

  it('allows an event date and an explicit completion deadline with distinct grounded evidence', () => {
    expect(validateWeeklyPlanningUserContextConsistencyV5(documentWith({
      eventSourceText: '来月の金曜日に試験がある',
      deadlineSourceText: '試験までに問題集を終わらせたい',
    }))).toEqual([]);
  });

  it('allows the event occurrence without any work deadline', () => {
    expect(validateWeeklyPlanningUserContextConsistencyV5(documentWith({}))).toEqual([]);
  });
});
