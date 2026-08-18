import { describe, expect, it } from 'vitest';
import { compileGenericPlanningWorkItems } from './weeklyPlanningGenericWorkItems';
import type { EffortEstimateFact, PlanningTaskFact } from './weeklyPlanningFactGraph';
import type { WorkloadFactV5 } from './weeklyPlanningFactGraphV5';

const source = {
  conversationId: 'observed-per-unit',
  turnId: 'progress',
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

const completed: WorkloadFactV5 = {
  id: 'completed-12',
  taskId: task.id,
  componentId: null,
  quantityRole: 'completed',
  amount: 12,
  unitCode: 'page',
  unitLabel: '枚',
  rangeStart: null,
  rangeEnd: null,
  perOccurrence: false,
  periodExpression: null,
  source,
  createdRevision: 2,
};

const remaining: WorkloadFactV5 = {
  ...completed,
  id: 'remaining-8',
  quantityRole: 'remaining',
  amount: 8,
  createdRevision: 3,
};

const observedPace: EffortEstimateFact = {
  id: 'effort-completed-per-page',
  taskId: task.id,
  targetFactId: completed.id,
  kind: 'duration_per_unit',
  minutes: 8,
  unitCode: 'page',
  precision: 'approximate',
  source: {
    ...source,
    turnId: 'effort',
    semanticLocalId: 'observed-effort-per-page',
    sourceText: '1枚あたり8分くらいです',
  },
  createdRevision: 4,
};

describe('Stable V5 observed per-unit pace', () => {
  it('estimates remaining work from per-unit pace observed on completed work', () => {
    const result = compileGenericPlanningWorkItems({
      tasks: [task],
      components: [],
      workloads: [completed, remaining],
      effortEstimates: [observedPace],
    });

    expect(result.readiness).toBe('ready');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      workloadFactId: remaining.id,
      quantityRole: 'remaining',
      baseEstimatedMinutes: 64,
      estimateBasis: 'observed_pace',
      estimateSourceFactIds: [observedPace.id],
      estimateSourceWorkloadFactIds: [completed.id],
      actionability: 'actionable',
    });
    expect(result.issues.some((issue) => issue.blocking)).toBe(false);
  });
});
