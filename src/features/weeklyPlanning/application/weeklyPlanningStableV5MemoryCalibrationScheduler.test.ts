import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningLearningStrategyProposalRecord } from '../intake/weeklyPlanningIntakeTypes';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import {
  compileWeeklyPlanningMemoryCalibrationSchedulerV5,
} from './weeklyPlanningStableV5MemoryCalibrationScheduler';

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

function proposal(): WeeklyPlanningLearningStrategyProposalRecord {
  return {
    id: 'proposal-calibration',
    kind: 'calibrate_memory_pace',
    taskId: 'task-1',
    workloadFactId: 'workload-1',
    scope: 'week',
    status: 'accepted',
    suggestedSessionMinutes: { min: 20, max: 20 },
    selectedSessionMinutes: 20,
    createdRevision: 2,
    proposedAtTurnId: 'turn-2',
    decidedAtTurnId: 'turn-3',
  };
}

const context = {
  ownerId: 'owner-1',
  currentDate: '2026-08-17',
  planningStartDate: '2026-08-17',
  planningEndDate: '2026-08-23',
  timeZone: 'Asia/Tokyo',
};

describe('Stable V5 memory calibration scheduler', () => {
  it('compiles one 20-minute trial without treating the full 220-word scope as 20 minutes', () => {
    const original = graph();
    const result = compileWeeklyPlanningMemoryCalibrationSchedulerV5({
      graph: original,
      proposal: proposal(),
      context,
      externalSources: [],
    });

    expect(result?.status).toBe('ready');
    expect(result?.input?.movableWorkItems).toHaveLength(1);
    expect(result?.input?.movableWorkItems[0]).toMatchObject({
      label: '英単語（ペース計測）',
      quantity: {
        amount: 1,
        unitCode: 'session',
        unitLabel: '回',
      },
      estimatedMinutes: 20,
    });
    expect(original.workloads).toEqual([
      expect.objectContaining({
        id: 'workload-1',
        amount: 220,
        unitCode: 'word',
      }),
    ]);
    expect(original.effortEstimates).toEqual([
      expect.objectContaining({
        targetFactId: 'workload-1',
        kind: 'session_duration',
        minutes: 20,
      }),
    ]);
    expect(original.effortEstimates.some((estimate) => estimate.kind === 'total_duration')).toBe(false);
  });

  it('does not compile a calibration view until that proposal is explicitly accepted', () => {
    expect(compileWeeklyPlanningMemoryCalibrationSchedulerV5({
      graph: graph(),
      proposal: { ...proposal(), status: 'pending', decidedAtTurnId: null },
      context,
      externalSources: [],
    })).toBeNull();
  });
});
