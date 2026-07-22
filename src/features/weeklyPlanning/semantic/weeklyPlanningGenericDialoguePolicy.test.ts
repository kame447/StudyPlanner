import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraph,
  type WeeklyPlanningFactDiff,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import type { GenericWorkItemCompilationResult } from './weeklyPlanningGenericWorkItems';
import {
  deriveGenericDialoguePolicy,
  evaluateGenericPreviewGate,
} from './weeklyPlanningGenericDialoguePolicy';

function createGraph(): WeeklyPlanningFactGraph {
  const graph = createEmptyWeeklyPlanningFactGraph();
  return {
    ...graph,
    revision: 1,
    tasks: [
      {
        id: 'task-study',
        category: 'study',
        title: '院試の過去問',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'task-study',
          sourceText: '院試の過去問',
          origin: 'user',
        },
        createdRevision: 1,
      },
      {
        id: 'task-research',
        category: 'non_study',
        title: '研究',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'task-research',
          sourceText: '研究',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    components: [
      {
        id: 'component-os',
        taskId: 'task-study',
        parentComponentId: null,
        role: 'field',
        label: 'OSとネットワーク',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'component-os',
          sourceText: 'OSとネットワーク',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    workloads: [
      {
        id: 'workload-os',
        taskId: 'task-study',
        componentId: 'component-os',
        quantityRole: 'target',
        amount: 1,
        unitCode: 'exam_year',
        unitLabel: '年分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'workload-os',
          sourceText: '1年分',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    effortEstimates: [
      {
        id: 'estimate-os',
        taskId: 'task-study',
        targetFactId: 'component-os',
        kind: 'duration_per_unit',
        minutes: 120,
        unitCode: 'exam_year',
        precision: 'approximate',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'estimate-os',
          sourceText: '1年分2時間',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    temporalConstraints: [
      {
        id: 'constraint-research-end',
        taskId: 'task-research',
        targetFactId: 'task-research',
        kind: 'latest_end',
        dateExpression: null,
        startTime: null,
        endTime: '15:00',
        precision: 'approximate',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'constraint-research-end',
          sourceText: '15時くらいまで',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
    relations: [
      {
        id: 'relation-research-before-study',
        kind: 'before',
        fromTaskId: 'task-research',
        toTaskId: 'task-study',
        source: {
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          semanticLocalId: 'relation-research-before-study',
          sourceText: 'その前に研究',
          origin: 'user',
        },
        createdRevision: 1,
      },
    ],
  };
}

function createDiff(): WeeklyPlanningFactDiff {
  return {
    fromRevision: 0,
    toRevision: 1,
    added: [
      { kind: 'task', id: 'task-study' },
      { kind: 'task', id: 'task-research' },
      { kind: 'workload', id: 'workload-os' },
      { kind: 'effort_estimate', id: 'estimate-os' },
      { kind: 'temporal_constraint', id: 'constraint-research-end' },
      { kind: 'relation', id: 'relation-research-before-study' },
    ],
    superseded: [],
    removed: [],
  };
}

function readyCompilation(): GenericWorkItemCompilationResult {
  return {
    readiness: 'ready',
    issues: [],
    items: [
      {
        version: 'weekly-planning-generic-work-item-v1',
        id: 'item-os',
        taskId: 'task-study',
        componentId: 'component-os',
        workloadFactId: 'workload-os',
        label: 'OSとネットワーク 1年分',
        quantityRole: 'target',
        actionability: 'actionable',
        quantity: {
          amount: 1,
          unitCode: 'exam_year',
          unitLabel: '年分',
          ordinalRange: { start: 1, end: 1 },
          actualRange: null,
        },
        estimatedMinutes: 120,
        estimateSourceFactIds: ['estimate-os'],
        splitPolicy: 'unknown',
        periodExpression: null,
        sourceFactRefs: ['task-study', 'component-os', 'workload-os', 'estimate-os'],
      },
    ],
  };
}

describe('generic weekly planning dialogue policy', () => {
  it('creates grounded acknowledgement items from the accepted fact diff', () => {
    const policy = deriveGenericDialoguePolicy({
      graph: createGraph(),
      diff: createDiff(),
      compilation: readyCompilation(),
    });

    expect(policy.readinessStage).toBe('preview_ready');
    expect(policy.nextQuestion).toBeNull();
    expect(policy.acknowledgementItems.map((item) => item.text)).toEqual(expect.arrayContaining([
      '「院試の過去問」',
      '「研究」',
      'OSとネットワークを1年分',
      'OSとネットワークは1exam_yearあたり約120分',
      '研究は15:00頃まで',
      '研究を院試の過去問より先に進める',
    ]));
  });

  it('asks only the highest-priority blocking question', () => {
    const compilation = readyCompilation();
    compilation.readiness = 'needs_resolution';
    compilation.issues = [
      {
        code: 'missing_effort_estimate',
        workloadFactId: 'workload-os',
        blocking: true,
      },
      {
        code: 'quantity_role_unresolved',
        workloadFactId: 'workload-os',
        blocking: true,
      },
    ];

    const policy = deriveGenericDialoguePolicy({
      graph: createGraph(),
      diff: createDiff(),
      compilation,
    });

    expect(policy.readinessStage).toBe('needs_resolution');
    expect(policy.nextQuestion).toEqual({
      issueCode: 'quantity_role_unresolved',
      targetFactId: 'workload-os',
      text: 'OSとネットワークの量は、今回進めたい量ですか、それとも残っている全体量ですか？',
    });
  });

  it('asks for a task before asking about workload', () => {
    const graph = createEmptyWeeklyPlanningFactGraph();
    const policy = deriveGenericDialoguePolicy({
      graph,
      diff: null,
      compilation: { items: [], issues: [], readiness: 'empty' },
    });

    expect(policy).toMatchObject({
      readinessStage: 'needs_task',
      nextQuestion: {
        issueCode: 'missing_task',
        targetFactId: null,
      },
    });
  });

  it('asks for workload when tasks exist but no workload facts exist', () => {
    const graph = createGraph();
    graph.workloads = [];
    const policy = deriveGenericDialoguePolicy({
      graph,
      diff: null,
      compilation: { items: [], issues: [], readiness: 'empty' },
    });

    expect(policy).toMatchObject({
      readinessStage: 'needs_workload',
      nextQuestion: {
        issueCode: 'missing_workload',
        targetFactId: 'task-study',
        text: '「院試の過去問」をどれくらい進めたいですか？',
      },
    });
  });

  it('does not acknowledge facts outside the supplied diff', () => {
    const diff = createDiff();
    diff.added = [{ kind: 'workload', id: 'workload-os' }];
    const policy = deriveGenericDialoguePolicy({
      graph: createGraph(),
      diff,
      compilation: readyCompilation(),
    });

    expect(policy.acknowledgementItems).toEqual([
      {
        factId: 'workload-os',
        kind: 'workload',
        text: 'OSとネットワークを1年分',
      },
    ]);
  });

  it('requires explicit current-revision authorization before preview', () => {
    const graph = createGraph();
    const policy = deriveGenericDialoguePolicy({
      graph,
      diff: createDiff(),
      compilation: readyCompilation(),
    });

    expect(evaluateGenericPreviewGate({
      conversationId: 'conversation-1',
      graph,
      policy,
      compilation: readyCompilation(),
      authorization: {
        status: 'assistant_suggested',
        conversationId: 'conversation-1',
        graphRevision: 1,
      },
    })).toEqual({ allowed: false, reasons: ['authorization_missing'] });

    expect(evaluateGenericPreviewGate({
      conversationId: 'conversation-1',
      graph,
      policy,
      compilation: readyCompilation(),
      authorization: {
        status: 'user_authorized',
        conversationId: 'conversation-1',
        graphRevision: 0,
      },
    })).toEqual({
      allowed: false,
      reasons: ['authorization_revision_mismatch'],
    });

    expect(evaluateGenericPreviewGate({
      conversationId: 'conversation-1',
      graph,
      policy,
      compilation: readyCompilation(),
      authorization: {
        status: 'user_authorized',
        conversationId: 'conversation-1',
        graphRevision: 1,
      },
    })).toEqual({ allowed: true, reasons: [] });
  });

  it('rejects preview when compilation still has unresolved facts', () => {
    const graph = createGraph();
    const compilation = readyCompilation();
    compilation.readiness = 'needs_resolution';
    compilation.items[0].actionability = 'needs_resolution';
    compilation.items[0].estimatedMinutes = null;
    compilation.issues.push({
      code: 'quantity_role_unresolved',
      workloadFactId: 'workload-os',
      blocking: true,
    });
    const policy = deriveGenericDialoguePolicy({
      graph,
      diff: createDiff(),
      compilation,
    });

    expect(evaluateGenericPreviewGate({
      conversationId: 'conversation-1',
      graph,
      policy,
      compilation,
      authorization: {
        status: 'user_authorized',
        conversationId: 'conversation-1',
        graphRevision: 1,
      },
    })).toEqual({
      allowed: false,
      reasons: [
        'readiness_not_ready',
        'blocking_compilation_issue',
        'unresolved_work_item',
        'missing_estimated_minutes',
      ],
    });
  });
});
