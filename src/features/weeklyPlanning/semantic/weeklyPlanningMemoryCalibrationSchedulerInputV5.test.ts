import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileWeeklyPlanningMemoryCalibrationSchedulerInputV5,
} from './weeklyPlanningMemoryCalibrationSchedulerInputV5';

function graph(): WeeklyPlanningFactGraphV5 {
  const source = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: 'workload-1',
    sourceText: '英単語220語を覚える',
    origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 2,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '英単語',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
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
    effortEstimates: [{
      id: 'effort-session-1',
      taskId: 'task-1',
      targetFactId: 'workload-1',
      kind: 'session_duration',
      minutes: 20,
      unitCode: 'word',
      precision: 'approximate',
      source,
      createdRevision: 2,
    }],
  };
}

const context = {
  ownerId: 'owner-1',
  currentDate: '2026-08-17',
  planningStartDate: '2026-08-17',
  planningEndDate: '2026-08-23',
  timeZone: 'Asia/Tokyo',
};

describe('Stable V5 memory calibration scheduler input', () => {
  it('compiles one trial session without rewriting the persisted full scope', () => {
    const original = graph();
    const result = compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({
      graph: original,
      workloadFactId: 'workload-1',
      sessionMinutes: 20,
      context,
      externalSources: [],
    });

    expect(result?.status).toBe('ready');
    expect(result?.input?.movableWorkItems).toHaveLength(1);
    expect(result?.input?.movableWorkItems[0]).toMatchObject({
      workloadFactId: 'workload-1',
      label: '英単語（ペース計測）',
      quantity: {
        amount: 1,
        unitCode: 'session',
        unitLabel: '回',
      },
      estimatedMinutes: 20,
    });
    expect(result?.input?.movableWorkItems[0].sourceFactRefs).toEqual(
      expect.arrayContaining(['workload-1', 'effort-session-1']),
    );
    expect(original.workloads).toEqual([
      expect.objectContaining({
        id: 'workload-1',
        amount: 220,
        unitCode: 'word',
      }),
    ]);
    expect(original.effortEstimates).toEqual([
      expect.objectContaining({
        id: 'effort-session-1',
        targetFactId: 'workload-1',
        kind: 'session_duration',
        minutes: 20,
      }),
    ]);
    expect(original.effortEstimates.some((estimate) => estimate.kind === 'total_duration')).toBe(false);
  });

  it('fails closed when there is no matching one-session duration evidence', () => {
    expect(compileWeeklyPlanningMemoryCalibrationSchedulerInputV5({
      graph: graph(),
      workloadFactId: 'workload-1',
      sessionMinutes: 25,
      context,
      externalSources: [],
    })).toBeNull();
  });
});
