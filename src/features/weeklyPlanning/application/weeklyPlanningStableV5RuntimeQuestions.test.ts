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

  it('does not ask a child scope again when the parent scope already has schedulable progress evidence', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{ id: 'task-physics', category: 'study', title: '物理', source, createdRevision: 1 }];
    graph.components = [
      {
        id: 'component-mechanics', taskId: 'task-physics', parentComponentId: null,
        role: 'field', label: '力学', source, createdRevision: 2,
      },
      {
        id: 'component-material', taskId: 'task-physics', parentComponentId: 'component-mechanics',
        role: 'material', label: '良問の風・力学', source, createdRevision: 3,
      },
      {
        id: 'component-chapters', taskId: 'task-physics', parentComponentId: 'component-material',
        role: 'chapter', label: '良問の風・力学の章立てに沿った各章', source, createdRevision: 3,
      },
    ];
    graph.workloads = [{
      id: 'workload-mechanics', taskId: 'task-physics', componentId: 'component-mechanics',
      quantityRole: 'remaining', amount: 100, unitCode: 'custom', unitLabel: '%',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      source, createdRevision: 4,
    }];
    graph.factLifecycles = [
      { factId: 'task-physics', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'component-mechanics', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
      { factId: 'component-material', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
      { factId: 'component-chapters', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
      { factId: 'workload-mechanics', status: 'active', createdRevision: 4, terminalRevision: null, supersededByFactId: null },
    ];

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBeNull();
    expect(question.message).not.toContain('良問の風・力学');
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

  it('asks open-ended progress when only completed evidence exists without a fixed total', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{ id: 'task-slides', category: 'study', title: '発表スライド', source, createdRevision: 1 }];
    graph.workloads = [{
      id: 'completed-pages', taskId: 'task-slides', componentId: null,
      quantityRole: 'completed', amount: 5, unitCode: 'page', unitLabel: 'ページ',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      source, createdRevision: 2,
    }];
    graph.factLifecycles = [
      { factId: 'task-slides', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'completed-pages', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    ];

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBe('task-slides');
    expect(question.message).toContain('100%');
    expect(question.message).not.toContain('全5ページ');
  });

  it('uses an explicit fixed total scope as the progress basis but not as schedulable work', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{ id: 'task-problems', category: 'study', title: '課題', source, createdRevision: 1 }];
    graph.workloads = [{
      id: 'scope-total-40', taskId: 'task-problems', componentId: null,
      quantityRole: 'scope_total', amount: 40, unitCode: 'problem', unitLabel: '問',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      source, createdRevision: 2,
    }];
    graph.factLifecycles = [
      { factId: 'task-problems', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'scope-total-40', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
    ];

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBe('task-problems');
    expect(question.message).toContain('全40問');
    expect(question.message).toContain('今どこまで');
  });

  it('does not ask progress again once a real remaining workload exists', () => {
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    graph.tasks = [{ id: 'task-slides', category: 'study', title: '発表スライド', source, createdRevision: 1 }];
    graph.workloads = [
      {
        id: 'scope-total-20', taskId: 'task-slides', componentId: null,
        quantityRole: 'scope_total', amount: 20, unitCode: 'page', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source, createdRevision: 2,
      },
      {
        id: 'remaining-8', taskId: 'task-slides', componentId: null,
        quantityRole: 'remaining', amount: 8, unitCode: 'page', unitLabel: '枚',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        source, createdRevision: 3,
      },
    ];
    graph.factLifecycles = [
      { factId: 'task-slides', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null },
      { factId: 'scope-total-20', status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null },
      { factId: 'remaining-8', status: 'active', createdRevision: 3, terminalRevision: null, supersededByFactId: null },
    ];

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBeNull();
    expect(question.message).toContain('予定に入れる作業がまだありません');
  });
});
