import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningWorkBreakdownResponseContractV5 } from './weeklyPlanningWorkBreakdownResponseContractV5';

function task(overrides: Record<string, unknown> = {}): any {
  return {
    localId: 'task-local',
    existingPublicId: 'task-target',
    decompositionStatus: 'decomposed',
    category: 'study',
    title: '対象',
    study: {
      purpose: 'homework',
      contextLabel: null,
      components: [{
        localId: 'component-1',
        existingPublicId: null,
        parentLocalId: null,
        role: 'material',
        label: '内訳A',
        workloads: [],
        durableContextSignals: [],
        sourceText: '内訳A',
      }],
    },
    workloads: [],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: '内訳Aが残っている',
    ...overrides,
  };
}

function document(tasks: any[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

const publicStateSummary = {
  pendingQuestion: {
    questionCode: 'semantic_uncertainty',
    targetFactId: 'uncertainty-public',
  },
  uncertainties: [{
    publicId: 'uncertainty-public',
    targetPublicId: 'task-target',
    field: 'work_breakdown',
  }],
};

function validate(value: WeeklyPlanningSemanticDocumentV5, userText = '内訳Aが残っている') {
  return validateWeeklyPlanningWorkBreakdownResponseContractV5({
    document: value,
    userText,
    publicStateSummary,
  });
}

describe('Stable V5 work breakdown response contract', () => {
  it('accepts one exact target task with current decomposition', () => {
    expect(validate(document([task()]))).toEqual([]);
  });

  it('rejects every extra top-level task and stale plan-wide state', () => {
    const value = document([
      task(),
      task({ localId: 'other', existingPublicId: null, title: '新しい別タスク' }),
    ]);
    value.planningWindow = {
      localId: 'window-local',
      kind: 'relative_week',
      value: 'next_week',
      start: null,
      end: null,
      sourceText: '前のターン',
    };
    value.userContextFacts = [{
      localId: 'context-1',
      kind: 'goal_event',
      label: 'イベント',
      value: null,
      dateExpression: 'custom:後日',
      sourceText: '前のターン',
    }];
    value.relations = [{
      localId: 'relation-1',
      kind: 'priority_over',
      fromLocalId: 'task-local',
      toLocalId: 'other',
      sourceText: '内訳Aが残っている',
    }];

    expect(validate(value)).toEqual([
      'document.tasks:work-breakdown-exact-target-only:count=2',
      'document.planningWindow:work-breakdown-current-delta-only',
      'document.userContextFacts:work-breakdown-current-delta-only',
      'document.relations:work-breakdown-current-delta-only',
    ]);
  });

  it('requires current-turn evidence on the exact target task', () => {
    expect(validate(
      document([task({ sourceText: '前のターンの説明' })]),
      '内訳Aと内訳Bが残っている',
    )).toContain('document:work-breakdown-target-current-evidence-required');
  });

  it('rejects decomposed study target without any constituents', () => {
    expect(validate(document([task({
      study: { purpose: 'homework', contextLabel: null, components: [] },
    })]))).toContain('document:work-breakdown-decomposed-without-constituents');
  });

  it('allows needs_breakdown to remain when it is grounded in the current answer', () => {
    expect(validate(
      document([task({
        decompositionStatus: 'needs_breakdown',
        study: { purpose: 'homework', contextLabel: null, components: [] },
        sourceText: 'まだ何が残っているか分かりません',
      })]),
      'まだ何が残っているか分かりません',
    )).toEqual([]);
  });

  it('does not apply outside a work_breakdown pending question', () => {
    expect(validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document: document([]),
      userText: '何か答える',
      publicStateSummary: {
        pendingQuestion: { questionCode: 'missing_schedulable_work', targetFactId: null },
        uncertainties: [],
      },
    })).toEqual([]);
  });
});
