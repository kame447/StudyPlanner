import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningCanonicalCorrectionsV5,
  isRedundantOrphanComponentV5,
  isRedundantOrphanTaskV5,
  isRedundantSupportFactV5,
  pruneableSupportFactIdsV5,
} from './weeklyPlanningCanonicalCorrectionApplicationV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  validateWeeklyPlanningFactGraphValueV5,
} from './weeklyPlanningFactGraphValidatorV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticTaskV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function task(localId: string, title: string, workloadLocalId: string, hours: number): SemanticTaskV5 {
  return {
    localId,
    category: 'study',
    title,
    study: {
      purpose: 'self_study',
      contextLabel: null,
      components: [],
    },
    workloads: [{
      localId: workloadLocalId,
      quantityRole: 'target',
      amount: hours,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: `${title}${hours}時間`,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    sourceText: `${title}を${hours}時間`,
  };
}

function document(params: {
  tasks: SemanticTaskV5[];
  corrections?: WeeklyPlanningSemanticDocumentV5['corrections'];
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: params.tasks,
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: params.corrections ?? [],
    decisions: [],
  };
}

function canonicalize(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  conversationId: string;
  turnId: string;
}) {
  const graph = params.graph ?? createEmptyWeeklyPlanningFactGraphV5();
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph,
    document: params.document,
    context: {
      conversationId: params.conversationId,
      turnId: params.turnId,
      expectedRevision: graph.revision,
    },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result;
}

function activeIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set(
    graph.factLifecycles
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.factId),
  );
}

describe('Stable V5 canonical correction application', () => {
  it('replaces a prior-turn workload and removes the duplicate replacement container', () => {
    const first = canonicalize({
      document: document({
        tasks: [task('task-math-old', '数学', 'workload-math-old', 3)],
      }),
      conversationId: 'conversation-single',
      turnId: 'turn-1',
    });
    const oldTaskId = first.localToFactId['task-math-old'];
    const oldWorkloadId = first.localToFactId['workload-math-old'];

    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [task('task-math-new', '数学', 'workload-math-new', 1)],
        corrections: [{
          localId: 'correction-math',
          target: {
            kind: 'workload',
            publicId: oldWorkloadId,
            localId: null,
            mention: '数学3時間',
          },
          operation: 'replace',
          replacementLocalId: 'workload-math-new',
          sourceText: '数学は3時間ではなく1時間',
        }],
      }),
      conversationId: 'conversation-single',
      turnId: 'turn-2',
    });

    const applied = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph,
      canonicalization: second,
      operationKeyPrefix: 'conversation-single:turn-2',
    });

    expect(applied.status).toBe('applied');
    const active = activeIds(applied.graph);
    const activeTasks = applied.graph.tasks.filter((fact) => active.has(fact.id));
    const activeWorkloads = applied.graph.workloads.filter((fact) => active.has(fact.id));
    expect(activeTasks).toHaveLength(1);
    expect(activeTasks[0]?.id).toBe(oldTaskId);
    expect(activeWorkloads).toHaveLength(1);
    expect(activeWorkloads[0]).toMatchObject({
      id: second.localToFactId['workload-math-new'],
      taskId: oldTaskId,
      amount: 1,
      unitCode: 'hour',
    });
    expect(applied.graph.factLifecycles.find(
      (entry) => entry.factId === oldWorkloadId,
    )).toMatchObject({
      status: 'superseded',
      supersededByFactId: second.localToFactId['workload-math-new'],
    });
    expect(validateWeeklyPlanningFactGraphValueV5(applied.graph).errors).toEqual([]);
  });

  it('applies two task-specific corrections without crossing their targets', () => {
    const first = canonicalize({
      document: document({
        tasks: [
          task('task-english-old', '英語', 'workload-english-old', 2),
          task('task-math-old', '数学', 'workload-math-old', 3),
        ],
      }),
      conversationId: 'conversation-multi',
      turnId: 'turn-1',
    });
    const oldEnglishTaskId = first.localToFactId['task-english-old'];
    const oldMathTaskId = first.localToFactId['task-math-old'];

    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [
          task('task-english-new', '英語', 'workload-english-new', 3),
          task('task-math-new', '数学', 'workload-math-new', 2),
        ],
        corrections: [
          {
            localId: 'correction-english',
            target: {
              kind: 'workload',
              publicId: first.localToFactId['workload-english-old'],
              localId: null,
              mention: '英語2時間',
            },
            operation: 'replace',
            replacementLocalId: 'workload-english-new',
            sourceText: '英語は3時間',
          },
          {
            localId: 'correction-math',
            target: {
              kind: 'workload',
              publicId: first.localToFactId['workload-math-old'],
              localId: null,
              mention: '数学3時間',
            },
            operation: 'replace',
            replacementLocalId: 'workload-math-new',
            sourceText: '数学は2時間',
          },
        ],
      }),
      conversationId: 'conversation-multi',
      turnId: 'turn-2',
    });

    const applied = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph,
      canonicalization: second,
      operationKeyPrefix: 'conversation-multi:turn-2',
    });

    expect(applied.status).toBe('applied');
    const active = activeIds(applied.graph);
    const activeTasks = applied.graph.tasks.filter((fact) => active.has(fact.id));
    const activeWorkloads = applied.graph.workloads.filter((fact) => active.has(fact.id));
    expect(activeTasks.map((fact) => fact.id).sort()).toEqual(
      [oldEnglishTaskId, oldMathTaskId].sort(),
    );
    expect(activeWorkloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: oldEnglishTaskId, amount: 3 }),
      expect.objectContaining({ taskId: oldMathTaskId, amount: 2 }),
    ]));
    expect(activeWorkloads).toHaveLength(2);
    expect(validateWeeklyPlanningFactGraphValueV5(applied.graph).errors).toEqual([]);
  });

  it('rejects an unresolved public target and rolls the whole turn back', () => {
    const first = canonicalize({
      document: document({
        tasks: [task('task-old', '英語', 'workload-old', 2)],
      }),
      conversationId: 'conversation-reject',
      turnId: 'turn-1',
    });
    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [task('task-new', '英語', 'workload-new', 3)],
        corrections: [{
          localId: 'correction-unresolved',
          target: {
            kind: 'workload',
            publicId: 'missing-public-id',
            localId: null,
            mention: '英語2時間',
          },
          operation: 'replace',
          replacementLocalId: 'workload-new',
          sourceText: '英語は3時間',
        }],
      }),
      conversationId: 'conversation-reject',
      turnId: 'turn-2',
    });

    const rejected = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph,
      canonicalization: second,
      operationKeyPrefix: 'conversation-reject:turn-2',
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.graph).toBe(first.graph);
    expect(rejected.errors).toEqual([
      expect.stringContaining('correction-target-kind-mismatch'),
    ]);
    expect(first.graph.revision).toBe(1);
  });
});

describe('pruneableSupportFactIdsV5', () => {
  it('keeps a support fact that is the replacement of a correction of the turn and still prunes a stub', () => {
    expect(pruneableSupportFactIdsV5({
      supportFactIds: new Set(['new-workload', 'stub']),
      correctionReplacementFactIds: ['new-workload', null],
    })).toEqual(['stub']);
  });
  it('prunes every support fact when no correction names it as a replacement', () => {
    expect(pruneableSupportFactIdsV5({ supportFactIds: ['a', 'b'], correctionReplacementFactIds: ['c'] })).toEqual(['a', 'b']);
  });
});

describe('isRedundantSupportFactV5', () => {
  const workload = (id: string, over: Record<string, unknown> = {}) => ({ id, taskId: 't', componentId: null, quantityRole: 'target', amount: 90,
    unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, ...over });
  const graph = (workloads: Array<{ id: string }>) => ({ workloads, factLifecycles: workloads.map(w => ({ factId: w.id, status: 'active' })) }) as never;
  it('a workload restating another active workload of the task is redundant', () => {
    expect(isRedundantSupportFactV5(graph([workload('a'), workload('b')]), 'b')).toBe(true);
  });
  it('a workload with content absent from the graph is not redundant', () => {
    expect(isRedundantSupportFactV5(graph([workload('a'), workload('b', { amount: 60 })]), 'b')).toBe(false);
    expect(isRedundantSupportFactV5(graph([workload('a'), workload('b', { perOccurrence: true })]), 'b')).toBe(false);
  });
  it('a non-workload support fact is never redundant', () => {
    expect(isRedundantSupportFactV5(graph([workload('a')]), 'not-a-workload')).toBe(false);
  });
});

describe('turn-created content that no correction installs is never deleted silently (X5d)', () => {
  const effortTask = (localId: string, workloadLocalId: string | null, hours: number, effortLocalId: string, effortTarget: string, minutes: number): SemanticTaskV5 => ({
    ...task(localId, '数学', workloadLocalId ?? 'unused', hours),
    workloads: workloadLocalId ? task(localId, '数学', workloadLocalId, hours).workloads : [],
    effortEstimates: [{ localId: effortLocalId, targetLocalId: effortTarget, kind: 'session_duration', minutes, unitCode: null, precision: 'approximate', sourceText: '1回分' }],
  });

  it('a replacement effort hanging from a new workload that no correction installs fails visibly', () => {
    const first = canonicalize({
      document: document({ tasks: [effortTask('task-old', 'workload-old', 3, 'effort-old', 'task-old', 45)] }),
      conversationId: 'conversation-support', turnId: 'turn-1',
    });
    const second = canonicalize({
      graph: first.graph,
      document: document({
        tasks: [effortTask('task-new', 'workload-new', 1, 'effort-new', 'workload-new', 30)],
        corrections: [{
          localId: 'correction-effort',
          target: { kind: 'effort_estimate', publicId: first.localToFactId['effort-old'], localId: null, mention: null },
          operation: 'replace', replacementLocalId: 'effort-new', sourceText: '1回30分',
        }],
      }),
      conversationId: 'conversation-support', turnId: 'turn-2',
    });
    const applied = applyWeeklyPlanningCanonicalCorrectionsV5({
      originalGraph: first.graph, canonicalization: second, operationKeyPrefix: 'conversation-support:turn-2',
    });
    expect(applied.status).toBe('rejected');
    expect(applied.errors.join('|')).toContain('correction-application:replacement-support-not-installed:');
  });
});

describe('container redundancy helpers (X5d/X5e)', () => {
  type Rec = Record<string, unknown>;
  const active = (...ids: string[]) => ids.map(factId => ({ factId, status: 'active' }));
  const component = (id: string, over: Rec = {}) => ({ id, taskId: 't', parentComponentId: null, role: 'section', label: '第2章', ...over });
  const workload = (id: string, componentId: string | null) => ({ id, taskId: 't', componentId, quantityRole: 'target', amount: 1, unitCode: 'minute',
    perOccurrence: false, periodExpression: null, rangeStart: null, rangeEnd: null });
  const graph = (over: Rec) => ({ tasks: [], components: [], workloads: [], effortEstimates: [], temporalConstraints: [], recurrences: [],
    studyContexts: [], factLifecycles: [], ...over }) as never;

  describe('isRedundantOrphanComponentV5', () => {
    const base = (orphan: Rec, extra: Rec = {}) => graph({ components: [component('target'), component('orphan', orphan)],
      factLifecycles: active('target', 'orphan', ...((extra.activeIds as string[]) ?? [])), ...extra });
    it('same role and label as a target component is redundant', () => {
      expect(isRedundantOrphanComponentV5(base({}), 'orphan', new Set(['target']))).toBe(true);
    });
    it('a different label is content, not redundant', () => {
      expect(isRedundantOrphanComponentV5(base({ label: '第3章' }), 'orphan', new Set(['target']))).toBe(false);
    });
    it('a different role is not redundant', () => {
      expect(isRedundantOrphanComponentV5(base({ role: 'material' }), 'orphan', new Set(['target']))).toBe(false);
    });
    it('an active workload still hanging from it is not redundant', () => {
      expect(isRedundantOrphanComponentV5(base({}, { workloads: [workload('w', 'orphan')], activeIds: ['w'] }), 'orphan', new Set(['target']))).toBe(false);
    });
    it('no target component (null) is not redundant', () => {
      expect(isRedundantOrphanComponentV5(base({}), 'orphan', new Set([null]))).toBe(false);
    });
  });

  describe('isRedundantOrphanTaskV5', () => {
    const task = (id: string, over: Rec = {}) => ({ id, title: '数学の課題', category: 'study', ...over });
    const context = (id: string, taskId: string, over: Rec = {}) => ({ id, taskId, purpose: 'self_study', contextLabel: null, ...over });
    const base = (orphan: Rec, extra: Rec = {}) => graph({ tasks: [task('target'), task('orphan', orphan)],
      studyContexts: [context('c1', 'target'), context('c2', 'orphan')],
      factLifecycles: active('target', 'orphan', 'c1', 'c2', ...((extra.activeIds as string[]) ?? [])), ...extra });
    it('same title, purpose and label is redundant', () => {
      expect(isRedundantOrphanTaskV5(base({}), 'orphan', new Set(['target']))).toBe(true);
    });
    it('a different title (a stated rename) is not redundant', () => {
      expect(isRedundantOrphanTaskV5(base({ title: '数学の宿題' }), 'orphan', new Set(['target']))).toBe(false);
    });
    it('a study context only on the orphan is content', () => {
      const g = graph({ tasks: [task('target'), task('orphan')], studyContexts: [context('c2', 'orphan')], factLifecycles: active('target', 'orphan', 'c2') });
      expect(isRedundantOrphanTaskV5(g, 'orphan', new Set(['target']))).toBe(false);
    });
    it('a different study purpose or label is not redundant', () => {
      const g = graph({ tasks: [task('target'), task('orphan')], studyContexts: [context('c1', 'target'), context('c2', 'orphan', { contextLabel: '宿題' })],
        factLifecycles: active('target', 'orphan', 'c1', 'c2') });
      expect(isRedundantOrphanTaskV5(g, 'orphan', new Set(['target']))).toBe(false);
    });
    it('an active child still hanging from it is not redundant, unless that child is pruned too', () => {
      const withChild = base({}, { workloads: [workload('w', null) && { ...workload('w', null), taskId: 'orphan' }], activeIds: ['w'] });
      expect(isRedundantOrphanTaskV5(withChild, 'orphan', new Set(['target']))).toBe(false);
      expect(isRedundantOrphanTaskV5(withChild, 'orphan', new Set(['target']), new Set(['w']))).toBe(true);
    });
  });
});
