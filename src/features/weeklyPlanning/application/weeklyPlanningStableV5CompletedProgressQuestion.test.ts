import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import { stableV5MissingSchedulableWorkQuestion } from './weeklyPlanningStableV5RuntimeQuestions';

const source = {
  conversationId: 'completed-progress-question',
  turnId: 'turn-1',
  semanticLocalId: 'local-1',
  sourceText: 'progress',
  origin: 'user' as const,
};

function workload(params: {
  id: string;
  taskId: string;
  componentId?: string | null;
  quantityRole: WorkloadFactV5['quantityRole'];
  amount: number;
  unitCode: WorkloadFactV5['unitCode'];
  unitLabel: string;
  revision: number;
}): WorkloadFactV5 {
  return {
    id: params.id,
    taskId: params.taskId,
    componentId: params.componentId ?? null,
    quantityRole: params.quantityRole,
    amount: params.amount,
    unitCode: params.unitCode,
    unitLabel: params.unitLabel,
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source: {
      ...source,
      semanticLocalId: params.id,
    },
    createdRevision: params.revision,
  };
}

function activate(graph: WeeklyPlanningFactGraphV5, factId: string, revision: number): void {
  graph.factLifecycles.push({
    factId,
    status: 'active',
    createdRevision: revision,
    terminalRevision: null,
    supersededByFactId: null,
  });
}

function taskGraph(title = '発表スライド'): WeeklyPlanningFactGraphV5 {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.tasks = [{
    id: 'task-1',
    category: 'study',
    title,
    source,
    createdRevision: 1,
  }];
  activate(graph, 'task-1', 1);
  return graph;
}

describe('Stable V5 completed progress question suppression', () => {
  it('does not ask the same open-ended task for progress again after 100 percent completion', () => {
    const graph = taskGraph();
    const completed = workload({
      id: 'completed-100',
      taskId: 'task-1',
      quantityRole: 'completed',
      amount: 100,
      unitCode: 'custom',
      unitLabel: '%',
      revision: 2,
    });
    graph.workloads = [completed];
    activate(graph, completed.id, 2);

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBeNull();
    expect(question.intent).toBe('all_requested_work_complete');
    expect(question.message).toContain('完了済み');
    expect(question.message).not.toContain('発表スライド');
    expect(question.message).not.toContain('100%とすると');
  });

  it('does not ask a fixed-total task for progress again once completed reaches the total', () => {
    const graph = taskGraph('課題');
    const total = workload({
      id: 'total-40',
      taskId: 'task-1',
      quantityRole: 'scope_total',
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      revision: 2,
    });
    const completed = workload({
      id: 'completed-40',
      taskId: 'task-1',
      quantityRole: 'completed',
      amount: 40,
      unitCode: 'problem',
      unitLabel: '問',
      revision: 3,
    });
    graph.workloads = [total, completed];
    activate(graph, total.id, 2);
    activate(graph, completed.id, 3);

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBeNull();
    expect(question.intent).toBe('all_requested_work_complete');
    expect(question.message).not.toContain('全40問');
  });

  it('does not fall back to the parent task after every decomposed leaf is complete', () => {
    const graph = taskGraph('研究発表');
    graph.components = [
      {
        id: 'component-a',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'material',
        label: '構成',
        source,
        createdRevision: 2,
      },
      {
        id: 'component-b',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'material',
        label: 'スライド作成',
        source,
        createdRevision: 2,
      },
    ];
    activate(graph, 'component-a', 2);
    activate(graph, 'component-b', 2);
    const completedA = workload({
      id: 'completed-a',
      taskId: 'task-1',
      componentId: 'component-a',
      quantityRole: 'completed',
      amount: 100,
      unitCode: 'custom',
      unitLabel: '%',
      revision: 3,
    });
    const completedB = workload({
      id: 'completed-b',
      taskId: 'task-1',
      componentId: 'component-b',
      quantityRole: 'completed',
      amount: 100,
      unitCode: 'custom',
      unitLabel: '%',
      revision: 4,
    });
    graph.workloads = [completedA, completedB];
    activate(graph, completedA.id, 3);
    activate(graph, completedB.id, 4);

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBeNull();
    expect(question.intent).toBe('all_requested_work_complete');
    expect(question.message).not.toContain('研究発表');
    expect(question.message).not.toContain('構成');
    expect(question.message).not.toContain('スライド作成');
  });

  it('asks only the incomplete leaf when another leaf is already complete', () => {
    const graph = taskGraph('研究発表');
    graph.components = [
      {
        id: 'component-a',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'material',
        label: '構成',
        source,
        createdRevision: 2,
      },
      {
        id: 'component-b',
        taskId: 'task-1',
        parentComponentId: null,
        role: 'material',
        label: 'スライド作成',
        source,
        createdRevision: 2,
      },
    ];
    activate(graph, 'component-a', 2);
    activate(graph, 'component-b', 2);
    const completedA = workload({
      id: 'completed-a',
      taskId: 'task-1',
      componentId: 'component-a',
      quantityRole: 'completed',
      amount: 100,
      unitCode: 'custom',
      unitLabel: '%',
      revision: 3,
    });
    graph.workloads = [completedA];
    activate(graph, completedA.id, 3);

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBe('component-b');
    expect(question.intent).toBe('existing_target_progress');
    expect(question.message).toContain('スライド作成');
    expect(question.message).not.toContain('「構成」');
  });

  it('asks a second incomplete task instead of treating the whole request as complete', () => {
    const graph = taskGraph('完了タスク');
    graph.tasks.push({
      id: 'task-2',
      category: 'study',
      title: '未完了タスク',
      source,
      createdRevision: 2,
    });
    activate(graph, 'task-2', 2);
    const completed = workload({
      id: 'completed-100',
      taskId: 'task-1',
      quantityRole: 'completed',
      amount: 100,
      unitCode: 'custom',
      unitLabel: '%',
      revision: 3,
    });
    graph.workloads = [completed];
    activate(graph, completed.id, 3);

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBe('task-2');
    expect(question.intent).toBe('existing_target_progress');
    expect(question.message).toContain('未完了タスク');
  });

  it('reopens only a newly added leaf after the previous leaves were complete', () => {
    const graph = taskGraph('研究発表');
    graph.components = [
      {
        id: 'component-a', taskId: 'task-1', parentComponentId: null,
        role: 'material', label: '構成', source, createdRevision: 2,
      },
      {
        id: 'component-b', taskId: 'task-1', parentComponentId: null,
        role: 'material', label: 'スライド', source, createdRevision: 2,
      },
      {
        id: 'component-c', taskId: 'task-1', parentComponentId: null,
        role: 'material', label: '発表練習', source, createdRevision: 5,
      },
    ];
    for (const component of graph.components) activate(graph, component.id, component.createdRevision);
    const completedA = workload({
      id: 'completed-a', taskId: 'task-1', componentId: 'component-a',
      quantityRole: 'completed', amount: 100, unitCode: 'custom', unitLabel: '%', revision: 3,
    });
    const completedB = workload({
      id: 'completed-b', taskId: 'task-1', componentId: 'component-b',
      quantityRole: 'completed', amount: 100, unitCode: 'custom', unitLabel: '%', revision: 4,
    });
    graph.workloads = [completedA, completedB];
    activate(graph, completedA.id, 3);
    activate(graph, completedB.id, 4);

    const question = stableV5MissingSchedulableWorkQuestion(graph);

    expect(question.targetFactId).toBe('component-c');
    expect(question.intent).toBe('existing_target_progress');
    expect(question.message).toContain('発表練習');
  });
});
