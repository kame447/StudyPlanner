import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningStableV5DialogueProjection } from './weeklyPlanningStableV5DialogueProjection';

describe('Stable V5 dialogue projection', () => {
  it('exposes only active facts and never resurfaces superseded or removed facts', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const source = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      semanticLocalId: 'local-1',
      sourceText: '夜じゃなくて朝にして',
      origin: 'user' as const,
    };
    graph.revision = 3;
    graph.tasks = [
      { id: 'task-old', category: 'study', title: '古い数学', source, createdRevision: 1 },
      { id: 'task-new', category: 'study', title: '数学', source, createdRevision: 2 },
      { id: 'task-removed', category: 'study', title: '削除済み英語', source, createdRevision: 1 },
    ];
    graph.temporalConstraints = [
      {
        id: 'time-old',
        taskId: 'task-new',
        targetFactId: 'task-new',
        kind: 'preferred_window',
        constraintLevel: 'soft',
        dateExpression: null,
        namedTimePeriod: 'night',
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        source,
        createdRevision: 1,
      },
      {
        id: 'time-new',
        taskId: 'task-new',
        targetFactId: 'task-new',
        kind: 'preferred_window',
        constraintLevel: 'soft',
        dateExpression: null,
        namedTimePeriod: 'morning',
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        source,
        createdRevision: 2,
      },
    ];
    graph.factLifecycles = [
      { factId: 'task-old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'task-new' },
      { factId: 'task-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
      { factId: 'task-removed', status: 'removed', createdRevision: 1, terminalRevision: 3, supersededByFactId: null },
      { factId: 'time-old', status: 'superseded', createdRevision: 1, terminalRevision: 2, supersededByFactId: 'time-new' },
      { factId: 'time-new', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    ];

    const projection = createWeeklyPlanningStableV5DialogueProjection(graph);

    expect(projection.tasks).toEqual([
      expect.objectContaining({ id: 'task-new', title: '数学' }),
    ]);
    expect(projection.temporalConstraints).toEqual([
      expect.objectContaining({ id: 'time-new', namedTimePeriod: 'morning' }),
    ]);
    expect(JSON.stringify(projection)).not.toContain('古い数学');
    expect(JSON.stringify(projection)).not.toContain('削除済み英語');
    expect(JSON.stringify(projection)).not.toContain('night');
  });

  it('keeps lifecycle-less legacy fixtures readable instead of projecting an empty dialogue state', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{
      id: 'task-legacy',
      category: 'study',
      title: '数学',
      source: {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        semanticLocalId: 'task-local',
        sourceText: '数学',
        origin: 'user',
      },
      createdRevision: 1,
    }];

    expect(createWeeklyPlanningStableV5DialogueProjection(graph).tasks).toEqual([
      expect.objectContaining({ id: 'task-legacy' }),
    ]);
  });
});
