import { describe, expect, it } from 'vitest';
import {
  validateWeeklyPlanningSemanticValueV5,
} from '../semantic/weeklyPlanningSemanticValidatorV5';

function emptyDocument() {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function taskWith(params: {
  workloads?: unknown[];
  effortEstimates?: unknown[];
  recurrence?: unknown[];
}) {
  return {
    localId: 'task-1',
    decompositionStatus: 'atomic',
    category: 'study',
    title: '数学',
    study: {
      purpose: 'practice',
      contextLabel: null,
      components: [],
    },
    workloads: params.workloads ?? [],
    effortEstimates: params.effortEstimates ?? [],
    temporalConstraints: [],
    recurrence: params.recurrence ?? [],
    durableContextSignals: [],
    sourceText: '数学を進めたいです',
  };
}

function workload(amount: number) {
  return {
    localId: 'workload-1',
    quantityRole: 'target',
    amount,
    unitCode: 'problem',
    unitLabel: '問',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    sourceText: '数学を進めたいです',
  };
}

describe('Issue #152 numeric resource safety boundary', () => {
  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    1e100,
    1e300,
  ])('rejects a finite workload amount outside integer-safe arithmetic: %s', (amount) => {
    const result = validateWeeklyPlanningSemanticValueV5({
      ...emptyDocument(),
      tasks: [taskWith({ workloads: [workload(amount)] })],
    });

    expect(Number.isFinite(amount)).toBe(true);
    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].workloads[0].amount');
  });

  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    1e100,
    1e300,
  ])('rejects a finite effort estimate outside integer-safe arithmetic: %s', (minutes) => {
    const result = validateWeeklyPlanningSemanticValueV5({
      ...emptyDocument(),
      tasks: [taskWith({
        effortEstimates: [{
          localId: 'effort-1',
          targetLocalId: 'task-1',
          kind: 'total_duration',
          minutes,
          unitCode: null,
          precision: 'exact',
          sourceText: '数学を進めたいです',
        }],
      })],
    });

    expect(Number.isFinite(minutes)).toBe(true);
    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].effortEstimates[0].minutes');
  });

  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    1e100,
    1e300,
  ])('rejects a finite recurrence count outside integer-safe arithmetic: %s', (count) => {
    const result = validateWeeklyPlanningSemanticValueV5({
      ...emptyDocument(),
      tasks: [taskWith({
        recurrence: [{
          localId: 'recurrence-1',
          targetLocalId: 'task-1',
          kind: 'times_per_week',
          count,
          days: [],
          sourceText: '数学を進めたいです',
        }],
      })],
    });

    expect(Number.isFinite(count)).toBe(true);
    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].recurrence[0].count');
  });

  it('keeps ordinary positive quantities inside the accepted numeric domain', () => {
    const result = validateWeeklyPlanningSemanticValueV5({
      ...emptyDocument(),
      tasks: [taskWith({ workloads: [workload(20)] })],
    });

    expect(result.errors).toEqual([]);
    expect(result.document).not.toBeNull();
  });
});
