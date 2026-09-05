import { describe, expect, it } from 'vitest';
import type {
  EffortEstimateFact,
  WorkloadFact,
} from '../semantic/weeklyPlanningFactGraph';
import {
  resolveGenericWorkItemEstimate,
} from '../semantic/weeklyPlanningGenericWorkEstimation';
import {
  WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5,
  isWeeklyPlanningSafePositiveNumberV5,
} from '../semantic/weeklyPlanningNumericSafetyV5';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from '../semantic/weeklyPlanningSemanticResponseValidationV5';
import {
  DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
  deriveWeeklyPlanningSessionPolicyV5,
} from '../semantic/weeklyPlanningStableV5ExecutionProfile';
import {
  splitWeeklyPlanningSessionMinutesV5,
} from '../semantic/weeklyPlanningStableV5SessionSplitter';

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

function validateResponse(value: unknown) {
  return validateWeeklyPlanningSemanticResponseV5(JSON.stringify(value), {});
}

const factSource = {
  conversationId: 'issue152-numeric',
  turnId: 'turn-1',
  semanticLocalId: 'local-1',
  sourceText: '数学を進めたいです',
  origin: 'user' as const,
};

function workloadFact(amount: number): WorkloadFact {
  return {
    id: 'workload-1',
    taskId: 'task-1',
    componentId: null,
    quantityRole: 'target',
    amount,
    unitCode: 'problem',
    unitLabel: '問',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: factSource,
    createdRevision: 1,
  };
}

function effortFact(minutes: number): EffortEstimateFact {
  return {
    id: 'effort-1',
    taskId: 'task-1',
    targetFactId: 'workload-1',
    kind: 'duration_per_unit',
    minutes,
    unitCode: 'problem',
    precision: 'exact',
    source: factSource,
    createdRevision: 1,
  };
}

describe('Issue #152 numeric resource safety boundary', () => {
  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    1e100,
    1e300,
  ])('rejects a finite workload amount outside integer-safe arithmetic: %s', (amount) => {
    const result = validateResponse({
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
    const result = validateResponse({
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
    const result = validateResponse({
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
    const result = validateResponse({
      ...emptyDocument(),
      tasks: [taskWith({ workloads: [workload(20)] })],
    });

    expect(result.errors).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(isWeeklyPlanningSafePositiveNumberV5(20)).toBe(true);
  });

  it('turns an overflowed per-unit estimate into an unresolved estimate instead of zero', () => {
    const workload = workloadFact(Number.MAX_SAFE_INTEGER);
    const result = resolveGenericWorkItemEstimate({
      workload,
      workloads: [workload],
      estimates: [effortFact(2)],
    });

    expect(result).toMatchObject({
      estimatedMinutes: null,
      basis: null,
      ambiguous: false,
    });
  });

  it('refuses to allocate an unbounded session array from legacy or malformed totals', () => {
    const profile = DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5;
    const policy = deriveWeeklyPlanningSessionPolicyV5({ profile });
    const oversizedTotal = (
      WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5 + 1
    ) * policy.maxSessionMinutes;

    expect(splitWeeklyPlanningSessionMinutesV5({
      totalMinutes: oversizedTotal,
      policy,
      profile,
    })).toEqual([]);

    expect(splitWeeklyPlanningSessionMinutesV5({
      totalMinutes: 240,
      policy,
      profile,
    }).length).toBeGreaterThan(0);
  });
});
