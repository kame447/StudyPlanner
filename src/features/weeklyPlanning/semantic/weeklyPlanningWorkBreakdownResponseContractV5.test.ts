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

function validate(value: WeeklyPlanningSemanticDocumentV5) {
  return validateWeeklyPlanningWorkBreakdownResponseContractV5({
    document: value,
    publicStateSummary,
  });
}

describe('Stable V5 work breakdown response contract', () => {
  it('accepts one exact target task with current decomposition', () => {
    expect(validate(document([task()]))).toEqual([]);
  });

  it('keeps the pending target while allowing other explicit current-turn contributions', () => {
    const value = document([
      task(),
      task({
        localId: 'other',
        existingPublicId: 'task-other',
        title: '同じ発話で回答した別タスク',
        sourceText: '物理もほぼ全部残っています',
      }),
    ]);
    value.planningWindow = {
      localId: 'window-local',
      kind: 'absolute',
      value: '2026-09-01/2026-09-30',
      start: '2026-09-01',
      end: '2026-09-30',
      sourceText: '9月中に進めたい',
    };
    value.userContextFacts = [{
      localId: 'context-1',
      kind: 'concern',
      label: '物理',
      value: '苦手',
      dateExpression: null,
      sourceText: '物理が苦手です',
    }];
    value.relations = [{
      localId: 'relation-1',
      kind: 'priority_over',
      fromLocalId: 'task-local',
      toLocalId: 'other',
      sourceText: '数学を物理より優先したい',
    }];

    expect(validate(value)).toEqual([]);
  });

  it('requires the pending work-breakdown target to remain represented', () => {
    expect(validate(document([
      task({ localId: 'other', existingPublicId: 'task-other' }),
    ]))).toEqual([
      'document:work-breakdown-target-task-required:target=task-target',
    ]);
  });

  it('does not reinterpret target sourceText against raw user text', () => {
    expect(validate(document([task({ sourceText: 'AI structured provenance' })]))).toEqual([]);
  });

  it('rejects decomposed study target without any constituents', () => {
    expect(validate(document([task({
      study: { purpose: 'homework', contextLabel: null, components: [] },
    })]))).toContain('document:work-breakdown-decomposed-without-constituents');
  });

  it('rejects reopening work_breakdown on the same parent after decomposition is resolved', () => {
    const value = document([task()]);
    value.uncertainties = [{
      localId: 'uncertainty-again',
      targetLocalId: 'task-local',
      field: 'work_breakdown',
      reason: '具体的な問題数や総時間は分からない',
      sourceText: '分からない量は作らないでください',
    }];

    expect(validate(value)).toContain(
      'document:work-breakdown-decomposed-target-cannot-remain-uncertain',
    );
  });

  it('allows needs_breakdown to remain when the structured answer is still unresolved', () => {
    expect(validate(document([task({
      decompositionStatus: 'needs_breakdown',
      study: { purpose: 'homework', contextLabel: null, components: [] },
      sourceText: 'まだ何が残っているか分かりません',
    })]))).toEqual([]);
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
