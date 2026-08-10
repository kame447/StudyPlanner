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

function source(semanticLocalId: string, sourceText: string) {
  return {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    semanticLocalId,
    sourceText,
    origin: 'user' as const,
  };
}

function createGraph(): WeeklyPlanningFactGraph {
  return {
    ...createEmptyWeeklyPlanningFactGraph(),
    revision: 1,
    tasks: [
      {
        id: 'task-study',
        category: 'study',
        title: '院試の過去問',
        source: source('task-study', '院試の過去問'),
        createdRevision: 1,
      },
      {
        id: 'task-research',
        category: 'non_study',
        title: '研究',
        source: source('task-research', '研究'),
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
        source: source('component-os', 'OSとネットワーク'),
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
        source: source('workload-os', '1年分'),
        createdRevision: 1,
      },
      {
        id: 'workload-research',
        taskId: 'task-research',
        componentId: null,
        quantityRole: 'target',
        amount: 60,
        unitCode: 'minute',
        unitLabel: '分',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        source: source('workload-research', '60分'),
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
        source: source('estimate-os', '1年分2時間'),
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
        source: source('constraint-research-end', '15時くらいまで'),
        createdRevision: 1,
      },
    ],
    relations: [
      {
        id: 'relation-research-before-study',
        kind: 'before',
        fromTaskId: 'task-research',
        toTaskId: 'task-study',
        source: source('relation-research-before-study', 'その前に研究'),
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
      { kind: 'workload', id: 'workload-research' },
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
      {
        version: 'weekly-planning-generic-work-item-v1',
        id: 'item-research',
        taskId: 'task-research',
        componentId: null,
        workloadFactId: 'workload-research',
        label: '研究 60分',
        quantityRole: 'target',
        actionability: 'actionable',
        quantity: {
          amount: 60,
          unitCode: 'minute',
          unitLabel: '分',
          ordinalRange: null,
          actualRange: null,
        },
        estimatedMinutes: 60,
        estimateSourceFactIds: [],
        splitPolicy: 'splittable',
        periodExpression: null,
        sourceFactRefs: ['task-research', 'workload-research'],
      },
    ],
  };
}

describe('generic weekly planning dialogue policy', () => {
  it('creates grounded acknowledgement without exposing internal unit codes', () => {
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
      '研究を60分',
      'OSとネットワークは1年分あたり約120分',
      '研究は15:00頃まで',
      '研究を院試の過去問より先に進める',
    ]));
    expect(JSON.stringify(policy.acknowledgementItems)).not.toContain('exam_year');
  });

  it('asks only the highest-priority blocking question', () => {
    const compilation = readyCompilation();
    compilation.readiness = 'needs_resolution';
    compilation.issues = [
      { code: 'missing_effort_estimate', workloadFactId: 'workload-os', blocking: true },
      { code: 'quantity_role_unresolved', workloadFactId: 'workload-os', blocking: true },
    ];

    const policy = deriveGenericDialoguePolicy({
      graph: createGraph(),
      diff: createDiff(),
      compilation,
    });

    expect(policy.nextQuestion).toEqual({
      issueCode: 'quantity_role_unresolved',
      targetFactId: 'workload-os',
      text: 'OSとネットワークの量は、今回進めたい量ですか、それとも残っている全体量ですか？',
    });
  });

  it('asks for task and workload in dependency order', () => {
    const emptyGraph = createEmptyWeeklyPlanningFactGraph();
    expect(deriveGenericDialoguePolicy({
      graph: emptyGraph,
      diff: null,
      compilation: { items: [], issues: [], readiness: 'empty' },
    }).readinessStage).toBe('needs_task');

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
        targetFactId: 'task-study',
        text: '「院試の過去問」をどれくらい進めたいですか？',
      },
    });
  });

  it('does not declare preview readiness while another task still lacks workload', () => {
    const graph = createGraph();
    graph.workloads = graph.workloads.filter((workload) => workload.taskId === 'task-study');
    const compilation = readyCompilation();
    compilation.items = compilation.items.filter((item) => item.taskId === 'task-study');

    const policy = deriveGenericDialoguePolicy({ graph, diff: null, compilation });

    expect(policy).toMatchObject({
      readinessStage: 'needs_workload',
      nextQuestion: {
        issueCode: 'missing_workload',
        targetFactId: 'task-research',
        text: '「研究」をどれくらい進めたいですか？',
      },
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
    })).toEqual({ allowed: false, reasons: ['readiness_not_ready'] });
  });

  it('acknowledges only facts included in the accepted diff', () => {
    const diff = createDiff();
    diff.added = [{ kind: 'workload', id: 'workload-os' }];
    const policy = deriveGenericDialoguePolicy({
      graph: createGraph(),
      diff,
      compilation: readyCompilation(),
    });

    expect(policy.acknowledgementItems).toEqual([
      { factId: 'workload-os', kind: 'workload', text: 'OSとネットワークを1年分' },
    ]);
  });

  it('requires explicit current-revision authorization before preview', () => {
    const graph = createGraph();
    const compilation = readyCompilation();
    const policy = deriveGenericDialoguePolicy({ graph, diff: createDiff(), compilation });

    expect(evaluateGenericPreviewGate({
      conversationId: 'conversation-1',
      graph,
      policy,
      compilation,
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
      compilation,
      authorization: {
        status: 'user_authorized',
        conversationId: 'conversation-1',
        graphRevision: 0,
      },
    })).toEqual({ allowed: false, reasons: ['authorization_revision_mismatch'] });

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
    })).toEqual({ allowed: true, reasons: [] });
  });

  it('rejects preview while facts or estimates remain unresolved', () => {
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
    const policy = deriveGenericDialoguePolicy({ graph, diff: createDiff(), compilation });

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
