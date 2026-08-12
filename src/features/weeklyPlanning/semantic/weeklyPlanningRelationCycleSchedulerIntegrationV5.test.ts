import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

const source = {
  conversationId: 'conversation-relation-cycle-integration',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: 'AとB',
  origin: 'user' as const,
};

function graph(): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...empty,
    revision: 1,
    tasks: ['a', 'b'].map((id) => ({
      id,
      category: 'study' as const,
      title: id.toUpperCase(),
      source: { ...source, semanticLocalId: `task-${id}` },
      createdRevision: 1,
    })),
    workloads: ['a', 'b'].map((id) => ({
      id: `workload-${id}`,
      taskId: id,
      componentId: null,
      quantityRole: 'target' as const,
      amount: 60,
      unitCode: 'minute' as const,
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source: { ...source, semanticLocalId: `workload-${id}` },
      createdRevision: 1,
    })),
    relations: [
      {
        id: 'relation-a-before-b',
        kind: 'before',
        fromTaskId: 'a',
        toTaskId: 'b',
        source: { ...source, semanticLocalId: 'r1' },
        createdRevision: 1,
      },
      {
        id: 'relation-b-before-a',
        kind: 'before',
        fromTaskId: 'b',
        toTaskId: 'a',
        source: { ...source, semanticLocalId: 'r2' },
        createdRevision: 1,
      },
    ],
  };
}

describe('relation cycle → scheduler resolution gate', () => {
  it('blocks instead of silently preserving arbitrary input order', () => {
    const result = compileGenericSchedulerInput({
      graph: graph(),
      context: {
        ownerId: 'owner-cycle',
        currentDate: '2026-08-12',
        planningStartDate: '2026-08-17',
        planningEndDate: '2026-08-23',
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(result.status).toBe('needs_resolution');
    expect(result.input).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({
      domain: 'relation',
      code: 'relation_cycle',
      blocking: true,
      details: {
        relationFactIds: 'relation-a-before-b,relation-b-before-a',
        taskIds: 'a,b',
      },
    }));
  });
});
