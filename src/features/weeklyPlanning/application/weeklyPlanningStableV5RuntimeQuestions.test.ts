import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { stableV5MissingSchedulableWorkQuestion } from './weeklyPlanningStableV5RuntimeQuestions';

const source = {
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  semanticLocalId: 'local-1',
  sourceText: 'project work',
  origin: 'user' as const,
};

function decomposedGraph() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 4;
  graph.tasks = [{
    id: 'task-project',
    category: 'study',
    title: 'Project work',
    source,
    createdRevision: 2,
  }];
  graph.components = [
    {
      id: 'component-umbrella',
      taskId: 'task-project',
      parentComponentId: null,
      role: 'custom',
      label: 'Project work',
      source,
      createdRevision: 2,
    },
    {
      id: 'component-concrete-a',
      taskId: 'task-project',
      parentComponentId: null,
      role: 'material',
      label: 'Concrete material A',
      source,
      createdRevision: 3,
    },
    {
      id: 'component-concrete-b',
      taskId: 'task-project',
      parentComponentId: null,
      role: 'custom',
      label: 'Concrete item B',
      source,
      createdRevision: 3,
    },
  ];
  graph.uncertainties = [{
    id: 'uncertainty-breakdown',
    targetFactId: 'task-project',
    field: 'work_breakdown',
    reason: 'constituents unknown',
    source,
    createdRevision: 2,
  }];
  graph.factLifecycles = [
    { factId: 'task-project', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    { factId: 'component-umbrella', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    { factId: 'component-concrete-a', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
    { factId: 'component-concrete-b', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
    { factId: 'uncertainty-breakdown', status: 'removed', createdRevision: 2, terminalRevision: 4, supersededByFactId: null },
  ];
  return graph;
}

describe('Stable V5 missing schedulable work question', () => {
  it('asks about one concrete post-breakdown component and persists its exact target', () => {
    const question = stableV5MissingSchedulableWorkQuestion(decomposedGraph());

    expect(question.message).toContain('「Concrete material A」');
    expect(question.message).not.toContain('「Project work」');
    expect(question.message).not.toContain('Concrete item B');
    expect(question.targetFactId).toBe('component-concrete-a');
  });

  it('moves to the next concrete component after the first has workload evidence', () => {
    const graph = decomposedGraph();
    graph.workloads = [{
      id: 'workload-a',
      taskId: 'task-project',
      componentId: 'component-concrete-a',
      quantityRole: 'target',
      amount: 10,
      unitCode: 'page',
      unitLabel: 'pages',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 5,
    }];
    graph.factLifecycles.push({
      factId: 'workload-a',
      status: 'active',
      createdRevision: 5,
      terminalRevision: null,
      supersededByFactId: null,
    });

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.message).toContain('「Concrete item B」');
    expect(question.targetFactId).toBe('component-concrete-b');
  });

  it('prefers an uncovered leaf over its broader component parent', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{
      id: 'task-1', category: 'study', title: 'Study', source, createdRevision: 1,
    }];
    graph.components = [
      {
        id: 'subject', taskId: 'task-1', parentComponentId: null,
        role: 'subject', label: 'Subject', source, createdRevision: 1,
      },
      {
        id: 'material', taskId: 'task-1', parentComponentId: 'subject',
        role: 'material', label: 'Material', source, createdRevision: 1,
      },
    ];
    graph.factLifecycles = [
      { factId: 'task-1', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'subject', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'material', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
    ];

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.message).toContain('「Material」');
    expect(question.targetFactId).toBe('material');
  });
});
