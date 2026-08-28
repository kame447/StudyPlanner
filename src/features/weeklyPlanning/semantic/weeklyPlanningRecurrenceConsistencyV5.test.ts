import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import {
  normalizeWeeklyPlanningRecurrenceConsistencyV5,
  validateWeeklyPlanningRecurrenceConsistencyV5,
} from './weeklyPlanningRecurrenceConsistencyV5';

function document(params: {
  periodExpression: string | null;
  recurrenceKind?: 'daily' | 'weekly' | 'weekdays' | 'weekends' | 'times_per_week' | 'custom';
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'discuss',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: null,
      category: 'study',
      title: '学習',
      study: null,
      workloads: [{
        localId: 'workload-1',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'hour',
        unitLabel: '時間',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: true,
        periodExpression: params.periodExpression,
        sourceText: '学習する',
      }],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: params.recurrenceKind ? [{
        localId: 'recurrence-1',
        targetLocalId: 'task-1',
        kind: params.recurrenceKind,
        count: params.recurrenceKind === 'times_per_week' ? 3 : null,
        days: [],
        sourceText: '繰り返す',
      }] : [],
      durableContextSignals: [],
      sourceText: '学習する',
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

function componentDocument(params: {
  recurrenceTargetLocalId: 'task-1' | 'component-a' | 'component-b';
}): WeeklyPlanningSemanticDocumentV5 {
  const workload = (localId: string, sourceText: string) => ({
    localId,
    quantityRole: 'target' as const,
    amount: 1,
    unitCode: 'problem' as const,
    unitLabel: '題',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: true,
    periodExpression: 'daily',
    sourceText,
  });
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      existingPublicId: null,
      category: 'study',
      title: '英語の毎日学習',
      study: {
        purpose: 'exam',
        contextLabel: '受験対策',
        components: [
          {
            localId: 'component-a',
            parentLocalId: null,
            role: 'material',
            label: '長文',
            workloads: [workload('workload-a', '長文を毎日1題')],
            sourceText: '長文を毎日1題',
          },
          {
            localId: 'component-b',
            parentLocalId: null,
            role: 'material',
            label: '英文解釈',
            workloads: [workload('workload-b', '英文解釈を毎日1題')],
            sourceText: '英文解釈を毎日1題',
          },
        ],
      },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [{
        localId: 'recurrence-1',
        targetLocalId: params.recurrenceTargetLocalId,
        kind: 'daily',
        count: null,
        days: [],
        sourceText: '毎日',
      }],
      durableContextSignals: [],
      sourceText: '英語を毎日学習する',
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

function withoutTaskRecurrence(
  value: WeeklyPlanningSemanticDocumentV5,
): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...value,
    tasks: value.tasks.map((task) => ({ ...task, recurrence: [] })),
  };
}

describe('Stable V5 recurrence consistency generalization', () => {
  it('requires weekly recurrence when periodExpression is canonical weekly', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'weekly',
    }))).toEqual([
      'document.tasks[0].workloads[0]:explicit-recurrence-missing:expected=weekly:target=task-1',
    ]);
  });

  it('accepts times_per_week when the matching recurrence exists', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'times_per_week',
      recurrenceKind: 'times_per_week',
    }))).toEqual([]);
  });

  it('accepts canonical custom recurrence form with custom recurrence', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'custom:隔日',
      recurrenceKind: 'custom',
    }))).toEqual([]);
  });

  it('does not turn a one-time period expression into recurrence', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(document({
      periodExpression: 'next_week',
    }))).toEqual([]);
  });

  it('lets one task-level recurrence cover per-occurrence workloads in all child components', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(componentDocument({
      recurrenceTargetLocalId: 'task-1',
    }))).toEqual([]);
  });

  it('does not let a component-level recurrence leak into a sibling component', () => {
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(componentDocument({
      recurrenceTargetLocalId: 'component-a',
    }))).toEqual([
      'document.tasks[0].study.components[1].workloads[0]:explicit-recurrence-missing:expected=daily:target=component-b',
    ]);
  });

  it('materializes daily recurrence for each component from explicit per-occurrence workload semantics', () => {
    const input = withoutTaskRecurrence(componentDocument({
      recurrenceTargetLocalId: 'task-1',
    }));
    const normalized = normalizeWeeklyPlanningRecurrenceConsistencyV5(input);

    expect(normalized.document.tasks[0].recurrence).toEqual([
      expect.objectContaining({
        targetLocalId: 'component-a',
        kind: 'daily',
        count: null,
        days: [],
        sourceText: '長文を毎日1題',
      }),
      expect.objectContaining({
        targetLocalId: 'component-b',
        kind: 'daily',
        count: null,
        days: [],
        sourceText: '英文解釈を毎日1題',
      }),
    ]);
    expect(normalized.repairs).toHaveLength(2);
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(normalized.document)).toEqual([]);
  });

  it('does not duplicate a matching task-level recurrence that already covers child workloads', () => {
    const input = componentDocument({ recurrenceTargetLocalId: 'task-1' });
    const normalized = normalizeWeeklyPlanningRecurrenceConsistencyV5(input);

    expect(normalized.document).toBe(input);
    expect(normalized.repairs).toEqual([]);
    expect(normalized.document.tasks[0].recurrence).toHaveLength(1);
  });

  it('does not invent times_per_week count when the workload lacks it', () => {
    const input = document({ periodExpression: 'times_per_week' });
    const normalized = normalizeWeeklyPlanningRecurrenceConsistencyV5(input);

    expect(normalized.document).toBe(input);
    expect(normalized.repairs).toEqual([]);
    expect(validateWeeklyPlanningRecurrenceConsistencyV5(normalized.document)).toEqual([
      'document.tasks[0].workloads[0]:explicit-recurrence-missing:expected=times_per_week:target=task-1',
    ]);
  });
});
