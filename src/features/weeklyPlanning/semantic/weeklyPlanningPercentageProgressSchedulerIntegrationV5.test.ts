import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningEffortQuestionPlanV5,
} from './weeklyPlanningEffortQuestionPolicyV5';
import {
  compileGenericPlanningWorkItems,
} from './weeklyPlanningGenericWorkItems';

const source = {
  conversationId: 'conversation-percent',
  turnId: 'turn-progress',
  semanticLocalId: 'remaining-percent',
  sourceText: '完成を100%とすると60%くらいです',
  origin: 'user' as const,
};

const task = {
  id: 'task-slides',
  category: 'study' as const,
  title: '夏合宿の発表スライド',
  source,
  createdRevision: 1,
};

const remaining = {
  id: 'remaining-40-percent',
  taskId: task.id,
  componentId: null,
  quantityRole: 'remaining' as const,
  amount: 40,
  unitCode: 'custom' as const,
  unitLabel: '%',
  rangeStart: null,
  rangeEnd: null,
  perOccurrence: false,
  periodExpression: null,
  source,
  createdRevision: 3,
};

describe('Stable V5 percentage progress scheduler integration', () => {
  it('asks for total remaining duration rather than inventing per-percent pace', () => {
    expect(createWeeklyPlanningEffortQuestionPlanV5(remaining)).toEqual({
      kind: 'total_duration',
      unitCode: null,
      sessionQuantities: [],
    });
  });

  it('keeps the percentage remainder unresolved until its own remaining duration is known', () => {
    const result = compileGenericPlanningWorkItems({
      tasks: [task],
      components: [],
      workloads: [remaining],
      effortEstimates: [],
    });

    expect(result.readiness).toBe('needs_resolution');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing_effort_estimate',
        workloadFactId: remaining.id,
        blocking: true,
      }),
    ]));
  });

  it('makes the remaining percentage actionable after a user estimate for the remaining work', () => {
    const result = compileGenericPlanningWorkItems({
      tasks: [task],
      components: [],
      workloads: [remaining],
      effortEstimates: [{
        id: 'effort-remaining-120',
        taskId: task.id,
        targetFactId: remaining.id,
        kind: 'total_duration',
        minutes: 120,
        unitCode: null,
        precision: 'approximate',
        source: {
          ...source,
          turnId: 'turn-effort',
          semanticLocalId: 'remaining-duration',
          sourceText: '残りはだいたい2時間くらいかかりそうです',
        },
        createdRevision: 4,
      }],
    });

    expect(result.readiness).toBe('ready');
    expect(result.issues.filter((issue) => issue.blocking)).toHaveLength(0);
    expect(result.items).toEqual([
      expect.objectContaining({
        taskId: task.id,
        workloadFactId: remaining.id,
        quantityRole: 'remaining',
        quantity: expect.objectContaining({
          amount: 40,
          unitCode: 'custom',
          unitLabel: '%',
        }),
        baseEstimatedMinutes: 120,
        estimatedMinutes: expect.any(Number),
        actionability: 'actionable',
      }),
    ]);
  });
});
