import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningSemanticEvidenceV5,
} from './weeklyPlanningSemanticEvidenceV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-local',
      existingPublicId: 'task-public',
      category: 'study',
      title: '共通テスト模試の勉強',
      study: {
        purpose: 'exam',
        contextLabel: '共通テスト模試',
        components: [{
          localId: 'component-local',
          existingPublicId: 'component-public',
          parentLocalId: null,
          role: 'subject',
          label: '数学',
          workloads: [{
            localId: 'workload-local',
            quantityRole: 'target',
            amount: 2,
            unitCode: 'hour',
            unitLabel: '時間',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: true,
            periodExpression: 'daily',
            sourceText: '毎日2時間くらい',
          }],
          durableContextSignals: [],
          sourceText: '特に数学が結構まずいです',
        }],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [{
        localId: 'recurrence-local',
        targetLocalId: 'component-local',
        kind: 'daily',
        count: null,
        days: [],
        sourceText: '毎日2時間くらい',
      }],
      durableContextSignals: [],
      sourceText: '2週間後に共通テスト模試もあるので、その勉強も進めたいです',
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

describe('Stable V5 bound entity evidence boundary', () => {
  it('does not require prior container evidence again when exact existingPublicId binds the entity', () => {
    expect(validateWeeklyPlanningSemanticEvidenceV5({
      document: document(),
      input: {
        userText: '模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。',
        publicStateSummary: {
          pendingQuestion: { questionCode: 'missing_schedulable_work' },
        },
      },
    })).toEqual([]);
  });

  it('still rejects a newly emitted durable concern whose evidence is not in the current turn', () => {
    const value = document();
    value.tasks[0].study!.components[0].durableContextSignals = [{
      localId: 'stale-concern',
      kind: 'concern',
      value: '結構まずい',
      sourceText: '数学が結構まずい',
    }];

    expect(validateWeeklyPlanningSemanticEvidenceV5({
      document: value,
      input: {
        userText: '模試の方は数学を中心に、毎日2時間くらい取れたらと思ってます。',
        publicStateSummary: {
          pendingQuestion: { questionCode: 'missing_schedulable_work' },
        },
      },
    })).toEqual([
      'document.tasks[0].study.components[0].durableContextSignals[0].sourceText:not-grounded-in-current-user-text',
    ]);
  });
});
