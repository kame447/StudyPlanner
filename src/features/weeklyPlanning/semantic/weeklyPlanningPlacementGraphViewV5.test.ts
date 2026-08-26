import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';

function source(id: string, text: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: text,
    origin: 'user' as const,
  };
}

describe('weekly planning placement graph view', () => {
  it('contains only active placement metadata and excludes temporal semantics entirely', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.revision = 2;
    graph.tasks.push({
      id: 'task-active',
      category: 'study',
      title: '金フレ',
      source: source('task-active', '金フレをやる'),
      createdRevision: 1,
    });
    graph.studyContexts.push(
      {
        id: 'context-removed',
        taskId: 'task-active',
        purpose: 'research',
        contextLabel: null,
        source: source('context-removed', '研究としてやる'),
        createdRevision: 1,
      },
      {
        id: 'context-active',
        taskId: 'task-active',
        purpose: 'review',
        contextLabel: null,
        source: source('context-active', '復習としてやる'),
        createdRevision: 2,
      },
    );
    graph.workloads.push(
      {
        id: 'workload-removed',
        taskId: 'task-active',
        componentId: null,
        quantityRole: 'target',
        amount: 30,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-removed', '30語'),
        createdRevision: 1,
      },
      {
        id: 'workload-active',
        taskId: 'task-active',
        componentId: null,
        quantityRole: 'target',
        amount: 60,
        unitCode: 'word',
        unitLabel: '語',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-active', '60語'),
        createdRevision: 2,
      },
    );
    graph.temporalConstraints.push({
      id: 'deadline-removed',
      taskId: 'task-active',
      targetFactId: 'task-active',
      kind: 'deadline',
      constraintLevel: 'hard',
      dateExpression: 'tomorrow',
      namedTimePeriod: null,
      startTime: null,
      endTime: null,
      precision: 'exact',
      source: source('deadline-removed', '明日まで'),
      createdRevision: 1,
    });
    graph.factLifecycles.push(
      {
        factId: 'task-active',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'context-removed',
        status: 'removed',
        createdRevision: 1,
        terminalRevision: 2,
        supersededByFactId: null,
      },
      {
        factId: 'context-active',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-removed',
        status: 'superseded',
        createdRevision: 1,
        terminalRevision: 2,
        supersededByFactId: 'workload-active',
      },
      {
        factId: 'workload-active',
        status: 'active',
        createdRevision: 2,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'deadline-removed',
        status: 'removed',
        createdRevision: 1,
        terminalRevision: 2,
        supersededByFactId: null,
      },
    );

    const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    const view = createWeeklyPlanningPlacementGraphViewV5(activeGraph);

    expect(Object.keys(view).sort()).toEqual([
      'components',
      'studyContexts',
      'tasks',
      'workloads',
    ]);
    expect(view.studyContexts.map((fact) => fact.id)).toEqual(['context-active']);
    expect(view.workloads.map((fact) => fact.id)).toEqual(['workload-active']);
    expect('temporalConstraints' in view).toBe(false);
  });
});
