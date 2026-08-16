import { describe, expect, it } from 'vitest';
import {
  compileGenericSchedulerInput,
  type WeeklyPlanningGenericSchedulerGraphView,
} from './weeklyPlanningGenericSchedulerInput';

const RAW_OBSERVED_MINUTES = (20 / 35) * 220;

function graph(): WeeklyPlanningGenericSchedulerGraphView {
  const source = {
    conversationId: 'conversation-observed-buffer',
    turnId: 'turn-1',
    semanticLocalId: 'workload',
    sourceText: '英単語220語',
    origin: 'user' as const,
  };
  return {
    revision: 1,
    planningWindows: [],
    tasks: [{
      id: 'task',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }] as unknown as WeeklyPlanningGenericSchedulerGraphView['tasks'],
    components: [],
    workloads: [{
      id: 'workload',
      taskId: 'task',
      componentId: null,
      quantityRole: 'target',
      amount: 220,
      unitCode: 'word',
      unitLabel: '語',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    taskDateRules: [],
    recurrences: [],
    relations: [],
    uncertainties: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
  };
}

describe('observed estimate scheduler safety buffer', () => {
  it('keeps the raw observed estimate while allocating safety-buffered scheduler time', () => {
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context: {
        ownerId: 'owner-observed-buffer',
        currentDate: '2026-08-16',
        planningStartDate: '2026-08-17',
        planningEndDate: '2026-08-23',
        timeZone: 'Asia/Tokyo',
      },
      observedEstimateOverrides: [{
        workloadFactId: 'workload',
        estimatedMinutes: RAW_OBSERVED_MINUTES,
        evidenceKind: 'observed_memory_pace',
        observationCount: 1,
      }],
    });

    expect(result.status).toBe('ready');
    const items = result.input?.movableWorkItems ?? [];
    expect(items).toHaveLength(1);
    expect(items.reduce(
      (sum, item) => sum + (item.estimatedMinutes ?? 0),
      0,
    )).toBe(150);
    expect(items.reduce(
      (sum, item) => sum + (item.baseEstimatedMinutes ?? 0),
      0,
    )).toBeCloseTo(RAW_OBSERVED_MINUTES);
    expect(items.every((item) => item.estimateBasis === 'observed_pace')).toBe(true);
    expect(items.every((item) => item.calibrationMultiplier === 1)).toBe(true);
  });
});
