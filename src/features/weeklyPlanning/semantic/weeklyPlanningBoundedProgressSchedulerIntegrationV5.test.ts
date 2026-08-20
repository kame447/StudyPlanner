import { describe, expect, it } from 'vitest';
import {
  compileGenericPlanningWorkItems,
} from './weeklyPlanningGenericWorkItems';
import {
  createWeeklyPlanningEffortQuestionPlanV5,
} from './weeklyPlanningEffortQuestionPolicyV5';
import type {
  PlanningTaskFact,
  EffortEstimateFact,
} from './weeklyPlanningFactGraph';
import type { WorkloadFactV5 } from './weeklyPlanningFactGraphV5';

const source = {
  conversationId: 'conversation-bounded-scheduler',
  turnId: 'turn-progress',
  semanticLocalId: 'progress',
  sourceText: '全20枚のうち12枚までできています',
  origin: 'user' as const,
};

const task: PlanningTaskFact = {
  id: 'task-slides',
  category: 'study',
  title: '夏合宿のスライド',
  source,
  createdRevision: 1,
};

const scopeTotal: WorkloadFactV5 = {
  id: 'scope-total-20',
  taskId: task.id,
  componentId: null,
  quantityRole: 'scope_total',
  amount: 20,
  unitCode: 'page',
  unitLabel: '枚',
  rangeStart: null,
  rangeEnd: null,
  perOccurrence: false,
  periodExpression: null,
  source,
  createdRevision: 2,
};

const completed: WorkloadFactV5 = {
  ...scopeTotal,
  id: 'completed-12',
  quantityRole: 'completed',
  amount: 12,
  createdRevision: 2,
};

const remaining: WorkloadFactV5 = {
  ...scopeTotal,
  id: 'remaining-8',
  quantityRole: 'remaining',
  amount: 8,
  source: {
    ...source,
    semanticLocalId: 'completed-12:derived-bounded-remaining:remaining-8',
  },
  createdRevision: 3,
};

describe('Stable V5 bounded progress scheduler integration', () => {
  it('never asks effort for the fixed total scope itself', () => {
    expect(scopeTotal.quantityRole).toBe('scope_total');
    expect(createWeeklyPlanningEffortQuestionPlanV5({
      amount: remaining.amount,
      unitCode: remaining.unitCode,
      unitLabel: remaining.unitLabel,
      quantityRole: 'remaining',
    })).toEqual({
      kind: 'duration_per_unit',
      unitCode: 'page',
      sessionQuantities: [],
    });
  });

  it('skips total/completed facts and asks effort only for the derived remaining work', () => {
    const result = compileGenericPlanningWorkItems({
      tasks: [task],
      components: [],
      workloads: [scopeTotal, completed, remaining],
      effortEstimates: [],
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      workloadFactId: remaining.id,
      quantityRole: 'remaining',
      quantity: { amount: 8, unitCode: 'page', unitLabel: '枚' },
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'scope_total_workload_skipped', workloadFactId: scopeTotal.id, blocking: false }),
      expect.objectContaining({ code: 'completed_workload_skipped', workloadFactId: completed.id, blocking: false }),
      expect.objectContaining({ code: 'missing_effort_estimate', workloadFactId: remaining.id, blocking: true }),
    ]));
  });

  it('becomes ready when effort is supplied for the remaining 8 slides only', () => {
    const effort: EffortEstimateFact = {
      id: 'effort-8-per-page',
      taskId: task.id,
      targetFactId: remaining.id,
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'page',
      precision: 'approximate',
      source: {
        ...source,
        turnId: 'turn-effort',
        semanticLocalId: 'effort-per-page',
        sourceText: '1枚あたり8分くらいです',
      },
      createdRevision: 4,
    };
    const result = compileGenericPlanningWorkItems({
      tasks: [task],
      components: [],
      workloads: [scopeTotal, completed, remaining],
      effortEstimates: [effort],
    });

    expect(result.readiness).toBe('ready');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      workloadFactId: remaining.id,
      quantityRole: 'remaining',
      baseEstimatedMinutes: 64,
      actionability: 'actionable',
    });
    expect(result.issues.some((issue) => issue.blocking)).toBe(false);
  });
});
