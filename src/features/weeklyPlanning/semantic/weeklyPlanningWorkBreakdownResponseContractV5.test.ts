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

describe('Stable V5 work breakdown response contract', () => {
  it('accepts one exact target task with current decomposition', () => {
    expect(validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document: document([task()]),
      publicStateSummary,
    })).toEqual([]);
  });

  it('rejects unrelated accepted tasks and stale plan-wide state', () => {
    const value = document([
      task(),
      task({ localId: 'other', existingPublicId: 'task-other', title: '別タスク' }),
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

    expect(validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document: value,
      publicStateSummary,
    })).toEqual([
      'document.tasks[1]:work-breakdown-unrelated-existing-task:task-other',
      'document.planningWindow:work-breakdown-current-delta-only',
      'document.userContextFacts:work-breakdown-current-delta-only',
    ]);
  });

  it('rejects decomposed study target without any constituents', () => {
    expect(validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document: document([task({
        study: { purpose: 'homework', contextLabel: null, components: [] },
      })]),
      publicStateSummary,
    })).toContain('document:work-breakdown-decomposed-without-constituents');
  });

  it('does not apply outside a work_breakdown pending question', () => {
    expect(validateWeeklyPlanningWorkBreakdownResponseContractV5({
      document: document([]),
      publicStateSummary: {
        pendingQuestion: { questionCode: 'missing_schedulable_work', targetFactId: null },
        uncertainties: [],
      },
    })).toEqual([]);
  });
});
