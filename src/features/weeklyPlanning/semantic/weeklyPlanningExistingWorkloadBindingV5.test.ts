import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { describe, expect, it } from 'vitest';
import { evaluateWeeklyPlanningStableV5ContextualAnswer } from './weeklyPlanningStableV5ContextualAnswer';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphValidatorV5';
import { effortEstimateTargetsWorkload } from './weeklyPlanningGenericWorkEstimation';
import {
  applyWeeklyPlanningExistingEntityBindingsV5,
} from './weeklyPlanningExistingEntityBindingApplicationV5';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5,
} from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

const source = {
  conversationId: 'conversation-workload-binding',
  turnId: 'turn-1',
  semanticLocalId: 'source-1',
  sourceText: '数学の問題集80問をやりたい',
  origin: 'user' as const,
};

function originalGraph(): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    appliedTurnKeys: ['conversation-workload-binding:turn-1'],
    tasks: [{
      id: 'task-public',
      category: 'study',
      title: '数学の問題集を解く',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-public',
      taskId: 'task-public',
      componentId: null,
      quantityRole: 'target',
      amount: 80,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-public',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-public',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function contextualDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-local',
      existingPublicId: 'task-public',
      decompositionStatus: 'decomposed',
      category: 'study',
      title: '数学の問題集を解く',
      study: {
        purpose: 'unknown',
        activityKind: 'problem_solving',
        contextLabel: null,
        components: [],
      },
      workloads: [{
        localId: 'workload-replayed',
        quantityRole: 'target',
        amount: 80,
        unitCode: 'problem',
        unitLabel: '問',
        rangeStart: null,
        rangeEnd: null,
        perOccurrence: false,
        periodExpression: null,
        sourceText: 'これ',
      }],
      effortEstimates: [],
      temporalConstraints: [{
        localId: 'deadline-local',
        targetLocalId: 'task-local',
        kind: 'deadline',
        constraintLevel: 'hard',
        dateExpression: '2026-08-23',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'unspecified',
        sourceText: '来週まで',
      }],
      recurrence: [],
      durableContextSignals: [],
      sourceText: 'これ来週まで',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [{
      localId: 'uncertainty-local',
      targetLocalId: 'workload-replayed',
      field: 'duration_per_unit',
      reason: 'pending effort remains unresolved',
      sourceText: 'まだほぼやってない',
    }],
    corrections: [],
    decisions: [],
  };
}

function apply(document: WeeklyPlanningSemanticDocumentV5, original = originalGraph()) {
  const canonicalization = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: original,
    document,
    context: {
      conversationId: 'conversation-workload-binding',
      turnId: 'turn-2',
      expectedRevision: 1,
    },
  });
  if (canonicalization.status !== 'applied') {
    throw new Error(canonicalization.errors.join(','));
  }
  return applyWeeklyPlanningExistingEntityBindingsV5({
    originalGraph: original,
    document,
    canonicalization,
  });
}

describe('Stable V5 existing workload binding', () => {
  it('collapses an unchanged replayed workload onto the active existing workload', () => {
    const result = apply(contextualDocument());

    expect(result.status).toBe('applied');
    expect(result.canonicalization.localToFactId['workload-replayed']).toBe('workload-public');
    expect(result.canonicalization.diff?.added).not.toContainEqual(
      expect.objectContaining({ kind: 'workload' }),
    );

    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(
      result.canonicalization.graph,
    );
    expect(active.workloads).toEqual([
      expect.objectContaining({
        id: 'workload-public',
        taskId: 'task-public',
        amount: 80,
        unitCode: 'problem',
      }),
    ]);
    expect(active.temporalConstraints).toEqual([
      expect.objectContaining({
        taskId: 'task-public',
        targetFactId: 'task-public',
        kind: 'deadline',
        dateExpression: '2026-08-23',
      }),
    ]);
    expect(active.uncertainties).toEqual([
      expect.objectContaining({
        targetFactId: 'workload-public',
      }),
    ]);
  });

  it('uses the stable unit label to bind an effort-only replay when Luna changes only the canonical unit code', () => {
    const original = originalGraph();
    original.workloads[0] = {
      ...original.workloads[0],
      quantityRole: 'completed',
      amount: 12,
      unitCode: 'custom',
      unitLabel: '枚',
    };
    const document = contextualDocument();
    document.tasks[0].workloads = [{
      localId: 'workload-replayed',
      quantityRole: 'completed',
      amount: 12,
      unitCode: 'page',
      unitLabel: '枚',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: '1枚あたりだいたい8分くらいです',
    }];
    document.tasks[0].effortEstimates = [{
      localId: 'effort-1',
      targetLocalId: 'workload-replayed',
      kind: 'duration_per_unit',
      minutes: 8,
      unitCode: 'page',
      precision: 'approximate',
      sourceText: '1枚あたりだいたい8分くらいです',
    }];
    document.tasks[0].temporalConstraints = [];
    document.uncertainties = [];

    const result = apply(document, original);
    expect(result.status).toBe('applied');
    expect(result.canonicalization.localToFactId['workload-replayed']).toBe('workload-public');
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(result.canonicalization.graph);
    expect(active.workloads).toEqual([
      expect.objectContaining({ id: 'workload-public', unitCode: 'custom', unitLabel: '枚', amount: 12 }),
    ]);
    expect(active.effortEstimates).toEqual([
      expect.objectContaining({
        kind: 'duration_per_unit',
        minutes: 8,
        unitCode: 'custom',
        targetFactId: 'workload-public',
      }),
    ]);
  });
});

// H2(1): exact workload references are selected with the final accepted reading.
// No component restatement, inferred quantity, clock-unit rate conversion or stubbed acceptance.
type ExactDurationKind = 'total_duration' | 'session_duration';
type ExactTask = WeeklyPlanningSemanticDocumentV5['tasks'][number];
type ExactWorkload = ExactTask['workloads'][number];
const DURATION_KINDS = ['total_duration', 'session_duration'] as const;
const EXACT_TEXT = '数学は合計30分、1回30分です。英語は前のままです。';
const EXACT_CONVERSATION = 'exact-workload-final-reading';
const EXACT_TARGET_ERROR = 'document.tasks[0].effortEstimates[0].targetLocalId';
const INVALID_INITIAL_ERROR = 'document.tasks[0].temporalConstraints[0].targetLocalId';

function exactDocument(tasks: ExactTask[]): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan', planningWindow: null, tasks,
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    userContextFacts: [], uncertainties: [], corrections: [], decisions: [],
  };
}
function exactTask(localId: string, title: string): ExactTask {
  return {
    localId, existingPublicId: null, decompositionStatus: 'atomic', category: 'study', title,
    study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [] },
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
    durableContextSignals: [], sourceText: EXACT_TEXT,
  };
}
function exactWorkload(localId: string, amount: number, sourceText: string): ExactWorkload {
  return {
    localId, quantityRole: 'target', amount, unitCode: 'page', unitLabel: 'ページ',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText,
  };
}
function exactFixture() {
  const own = exactTask('setup-math', '数学');
  own.sourceText = '数学の12ページと18ページを進めます';
  own.workloads = [
    exactWorkload('setup-a', 12, '数学の12ページ'),
    exactWorkload('setup-b', 18, '18ページ'),
  ];
  const other = exactTask('setup-english', '英語');
  other.sourceText = '英語の9ページを進めます';
  other.workloads = [exactWorkload('setup-c', 9, '英語の9ページ')];
  const accepted = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(), document: exactDocument([own, other]),
    context: { conversationId: EXACT_CONVERSATION, turnId: 'setup', expectedRevision: 0 },
  });
  if (accepted.status !== 'applied') throw new Error(accepted.errors.join(','));
  const graph = accepted.graph;
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
  const id = (localId: string) => {
    const factId = accepted.localToFactId[localId];
    if (!factId) throw new Error(`missing fixture ID: ${localId}`);
    return factId;
  };
  expect(graph.workloads.map(fact => fact.unitCode)).toEqual(['page', 'page', 'page']);
  expect(graph.components).toEqual([]);
  return { graph, own: id('setup-math'), other: id('setup-english'), a: id('setup-a'), b: id('setup-b'), c: id('setup-c') };
}
type ExactFixture = ReturnType<typeof exactFixture>;

function durationReading(f: ExactFixture, targetLocalId: string, kind: ExactDurationKind = 'total_duration') {
  const task = exactTask('reply-task', '数学');
  task.existingPublicId = f.own;
  task.effortEstimates = [{
    localId: 'reply-effort', targetLocalId, kind, minutes: 30,
    unitCode: kind === 'session_duration' ? 'session' : null, precision: 'exact', sourceText: EXACT_TEXT,
  }];
  return exactDocument([task]);
}
function replayReading(f: ExactFixture, workloadId: string, kind: ExactDurationKind = 'total_duration') {
  const fact = f.graph.workloads.find(item => item.id === workloadId);
  if (!fact) throw new Error('missing fixture workload');
  const document = durationReading(f, 'replayed-workload', kind);
  document.tasks[0].workloads = [exactWorkload('replayed-workload', fact.amount, fact.source.sourceText)];
  return document;
}
function invalidInitial(f: ExactFixture, workloadId: string) {
  const document = durationReading(f, workloadId);
  // A reference error is not a representation-only repair. The effort's entire
  // identity/value/quote stays identical across attempts; only its target changes.
  document.tasks[0].temporalConstraints = [{
    localId: 'invalid-constraint', targetLocalId: 'undeclared-target', kind: 'deadline',
    constraintLevel: 'hard', dateExpression: '2026-10-17', namedTimePeriod: null,
    startTime: null, endTime: null, precision: 'exact', sourceText: EXACT_TEXT,
  }];
  return document;
}
async function runDurationReadings(params: {
  graph: WeeklyPlanningFactGraphV5; documents: WeeklyPlanningSemanticDocumentV5[];
  turnId: string; userText?: string;
}) {
  const graphBefore = structuredClone(params.graph);
  const documentsBefore = structuredClone(params.documents);
  const rawResponses = params.documents.map(value => JSON.stringify(value));
  const calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(request) {
      calls.push(structuredClone(request));
      const raw = rawResponses[calls.length - 1];
      if (raw === undefined) throw new Error('unexpected extra provider call in exact-workload fixture');
      return raw;
    },
  };
  const result = await createWeeklyPlanningSemanticPipelineV5(
    createWeeklyPlanningSemanticNormalizerV5(client),
  ).run({
    graph: params.graph, conversationId: EXACT_CONVERSATION, turnId: params.turnId,
    expectedRevision: params.graph.revision, userText: params.userText ?? EXACT_TEXT,
    schedulerContext: { ownerId: 'exact-workload-owner', currentDate: '2026-10-10',
      planningStartDate: '2026-10-11', planningEndDate: '2026-10-17', timeZone: 'Asia/Tokyo' },
  });
  expect(params.graph).toEqual(graphBefore);
  expect(params.documents).toEqual(documentsBefore);
  expect(calls.length).toBeLessThanOrEqual(2);
  expect(calls.map(call => call.responseFormat?.json_schema.name)).toEqual(
    calls.map(() => 'weekly_planning_semantic_document_v5'),
  );
  expect(calls.every(call => call.purpose === 'weekly_planning_semantic_normalizer')).toBe(true);
  if (calls.length === 2) {
    expect(calls[1].messages).toContainEqual({ role: 'assistant', content: rawResponses[0] });
  }
  return { result, calls };
}
function expectAcceptedExactTarget(params: {
  result: Awaited<ReturnType<typeof runDurationReadings>>['result'];
  original: WeeklyPlanningFactGraphV5; targetFactId: string; kind?: ExactDurationKind;
}) {
  const { result, original, targetFactId } = params;
  // Never let a rejected final candidate or an accepted-normalizer stub stand in
  // for the final adoption boundary before checking canonical scope.
  expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics, null, 2)).toBe('accepted');
  expect(result.normalization.document).not.toBeNull();
  expect(result.normalization.document?.tasks).toHaveLength(1);
  expect(result.normalization.document?.tasks[0].effortEstimates).toEqual([
    expect.objectContaining({ localId: 'reply-effort', kind: params.kind ?? 'total_duration',
      minutes: 30, unitCode: params.kind === 'session_duration' ? 'session' : null,
      precision: 'exact', sourceText: EXACT_TEXT }),
  ]);
  expect(result.canonicalization?.status).toBe('applied');
  expect(result.graph.workloads).toEqual(original.workloads);
  expect(result.graph.tasks).toEqual(original.tasks);
  expect(result.graph.components).toEqual([]);
  expect(result.graph.temporalConstraints).toEqual([]);
  expect(result.graph.revision).toBe(original.revision + 1);
  const reloaded = parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(result.graph));
  expect(reloaded.errors).toEqual([]);
  expect(reloaded.graph).toEqual(result.graph);
  expect(reloaded.graph?.effortEstimates).toEqual([
    expect.objectContaining({ taskId: original.tasks[0].id, targetFactId,
      kind: params.kind ?? 'total_duration', minutes: 30,
      unitCode: params.kind === 'session_duration' ? 'session' : null,
      source: expect.objectContaining({ semanticLocalId: 'reply-effort', sourceText: EXACT_TEXT, origin: 'user' }) }),
  ]);
  expect(result.canonicalization?.diff?.added).toEqual([
    { kind: 'effort_estimate', id: result.graph.effortEstimates[0].id },
  ]);
  const effort = result.graph.effortEstimates[0];
  expect(original.workloads.map(workload => {
    if (workload.quantityRole !== 'target') throw new Error('exact-workload fixture requires target quantities');
    return effortEstimateTargetsWorkload(effort, { ...workload, quantityRole: workload.quantityRole });
  })).toEqual(
    original.workloads.map(workload => workload.taskId === effort.taskId
      && (workload.id === targetFactId || workload.taskId === targetFactId)),
  );
}

// Intended-contract baseline: the four public-ID acceptance rows are expected
// to be red on cb3167. Preserve and classify actual failures; do not preclaim results.
describe('Stable V5 final-reading exact workload reference boundary', () => {
  it.each(DURATION_KINDS)('keeps the existing local replay control for %s', async kind => {
    const f = exactFixture();
    const document = replayReading(f, f.a, kind);
    const { result, calls } = await runDurationReadings({ graph: f.graph, documents: [document], turnId: `local-${kind}` });
    expectAcceptedExactTarget({ result, original: f.graph, targetFactId: f.a, kind });
    expect(calls).toHaveLength(1);
    expect(result.normalization.document?.tasks[0].effortEstimates[0].targetLocalId).toBe('replayed-workload');
    expect(result.canonicalization?.localToFactId['replayed-workload']).toBe(f.a);
  });

  it.each(DURATION_KINDS)('accepts an exact active public workload target without importing quantity for %s', async kind => {
    const f = exactFixture();
    const document = durationReading(f, f.a, kind);
    const { result, calls } = await runDurationReadings({ graph: f.graph, documents: [document, document], turnId: `public-${kind}` });
    expectAcceptedExactTarget({ result, original: f.graph, targetFactId: f.a, kind });
    expect(calls).toHaveLength(1);
    expect(result.normalization.diagnostics).toMatchObject({ attemptCount: 1, repairAttempted: false });
    expect(result.normalization.document?.tasks[0].workloads).toEqual([]);
  });

  it.each(['a-to-b', 'b-to-a'] as const)('uses only the adopted exact target after invalid %s', async direction => {
    const f = exactFixture();
    const [discarded, adopted] = direction === 'a-to-b' ? [f.a, f.b] : [f.b, f.a];
    const first = invalidInitial(f, discarded);
    // Existing repair-to-local shape is the main-positive control before the
    // new public-ID representation. Both carry the very same intended target.
    const control = await runDurationReadings({ graph: f.graph,
      documents: [first, replayReading(f, adopted)], turnId: `repair-local-${direction}` });
    expectAcceptedExactTarget({ result: control.result, original: f.graph, targetFactId: adopted });
    expect(control.calls).toHaveLength(2);
    const { result, calls } = await runDurationReadings({ graph: f.graph,
      documents: [first, durationReading(f, adopted)], turnId: `repair-public-${direction}` });
    expectAcceptedExactTarget({ result, original: f.graph, targetFactId: adopted });
    expect(calls).toHaveLength(2);
    expect(result.normalization.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    expect(result.normalization.diagnostics.validationErrors).toContain(INVALID_INITIAL_ERROR);
    expect(result.normalization.document?.tasks[0].workloads).toEqual([]);
    expect(result.graph.effortEstimates[0].targetFactId).not.toBe(discarded);
  });

  it('does not narrow a final task-wide reading using an invalid earlier exact citation', async () => {
    const f = exactFixture();
    const final = durationReading(f, 'reply-task');
    const clean = await runDurationReadings({ graph: f.graph, documents: [final], turnId: 'clean-task-wide' });
    const repaired = await runDurationReadings({ graph: f.graph,
      documents: [invalidInitial(f, f.a), final], turnId: 'repaired-task-wide' });
    for (const attempt of [clean, repaired]) {
      expectAcceptedExactTarget({ result: attempt.result, original: f.graph, targetFactId: f.own });
      expect(attempt.result.normalization.document?.tasks[0].effortEstimates[0].targetLocalId).toBe('reply-task');
    }
    expect(clean.calls).toHaveLength(1);
    expect(repaired.calls).toHaveLength(2);
    expect(repaired.result.normalization.document).toEqual(clean.result.normalization.document);
    expect(repaired.result.normalization.diagnostics.validationErrors).toContain(INVALID_INITIAL_ERROR);
  });

  it.each(['unknown', 'foreign-workload', 'foreign-kind', 'removed', 'foreign-local-collision'] as const)(
    'keeps %s targets rejected on both real attempts', async boundary => {
      const f = exactFixture();
      let graph = f.graph;
      const target = boundary === 'unknown' ? 'unknown-workload'
        : boundary === 'foreign-workload' ? f.c : boundary === 'foreign-kind' ? f.other : f.a;
      if (boundary === 'removed') {
        const removed = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
          operation: { operationKey: 'remove-exact-a', kind: 'remove', targetFactId: f.a } });
        expect(removed.status).toBe('applied');
        graph = removed.graph;
        expect(createWeeklyPlanningActiveSchedulerGraphViewV5(graph).workloads.some(item => item.id === f.a)).toBe(false);
        expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
      }
      const document = durationReading(f, target);
      if (boundary === 'foreign-local-collision') {
        const declaration = exactTask(f.a, '英語');
        declaration.existingPublicId = f.other;
        document.tasks.push(declaration);
      }
      const { result, calls } = await runDurationReadings({ graph, documents: [document, document], turnId: `reject-${boundary}` });
      expect(calls).toHaveLength(2);
      expect(result.status).toBe('normalization_rejected');
      expect(result.normalization.document).toBeNull();
      expect(result.normalization.diagnostics.validationErrors).toContain(`initial:${EXACT_TARGET_ERROR}`);
      expect(result.normalization.diagnostics.validationErrors).toContain(`repair:${EXACT_TARGET_ERROR}`);
      expect(result.canonicalization).toBeNull();
      expect(result.graph).toEqual(graph);
    },
  );

  it('preserves a valid declared workload local ID instead of rebinding its spelling to an old public ID', async () => {
    const f = exactFixture();
    const document = durationReading(f, f.a);
    const quote = '数学に23ページを追加します。';
    document.tasks[0].workloads = [exactWorkload(f.a, 23, quote)];
    const { result, calls } = await runDurationReadings({ graph: f.graph,
      documents: [document], turnId: 'valid-local-collision', userText: `${EXACT_TEXT}${quote}` });
    expect(result.normalization.status).toBe('accepted');
    expect(result.canonicalization?.status).toBe('applied');
    expect(calls).toHaveLength(1);
    const newId = result.canonicalization?.localToFactId[f.a];
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(f.a);
    expect(result.graph.workloads).toHaveLength(f.graph.workloads.length + 1);
    expect(result.graph.workloads.slice(0, f.graph.workloads.length)).toEqual(f.graph.workloads);
    expect(result.graph.workloads.find(fact => fact.id === newId)?.amount).toBe(23);
    expect(result.graph.effortEstimates).toEqual([expect.objectContaining({ targetFactId: newId, minutes: 30 })]);
    expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(result.graph)).graph).toEqual(result.graph);
  });

  it('commits neither candidate when an exact citation is followed by an invalid repair', async () => {
    const f = exactFixture();
    const final = durationReading(f, f.b);
    final.tasks[0].effortEstimates[0].minutes = -1;
    const { result, calls } = await runDurationReadings({ graph: f.graph,
      documents: [invalidInitial(f, f.a), final], turnId: 'neither-accepted' });
    expect(calls).toHaveLength(2);
    expect(result.status).toBe('normalization_rejected');
    expect(result.normalization.document).toBeNull();
    expect(result.normalization.diagnostics.validationErrors).toContain(`initial:${INVALID_INITIAL_ERROR}`);
    expect(result.normalization.diagnostics.validationErrors.some(error => error.startsWith('repair:') && error.includes('.minutes'))).toBe(true);
    expect(result.canonicalization).toBeNull();
    expect(result.graph).toEqual(f.graph);
  });
});

const PENDING_REFERENCE_CASES = [
  { name: 'explicit B total while A is pending', key: 'b', kind: 'total_duration' },
  { name: 'explicit A session while total is pending', key: 'a', kind: 'session_duration' },
] as const;
function exactPendingQuestion(f: ExactFixture) {
  return { actionId: 'ask-exact-a', questionCode: 'missing_effort_estimate' as const,
    targetFactId: f.a, graphRevision: f.graph.revision, effortMeasurement: 'total_duration' as const };
}
async function runPendingDurationReading(f: ExactFixture, document: WeeklyPlanningSemanticDocumentV5, turnId: string) {
  const before = structuredClone(f.graph);
  const documentBefore = structuredClone(document);
  const fallback = JSON.stringify({ decision: 'fallback', effortTarget: null, effortMeasurement: null,
    minutes: null, precision: null, quantityRole: null });
  const raw = JSON.stringify(document);
  const responses = [fallback, raw, raw]; // Last raw is the existing single generic repair on main.
  const calls: Array<Parameters<OpenAiCompatibleClient['createChatCompletion']>[0]> = [];
  const client: OpenAiCompatibleClient = {
    async createChatCompletion(request) {
      calls.push(structuredClone(request));
      const index = calls.length - 1;
      const expectedSchema = index === 0 ? 'weekly_planning_focused_contextual_answer_v5'
        : 'weekly_planning_semantic_document_v5';
      if (request.responseFormat?.json_schema.name !== expectedSchema || responses[index] === undefined) {
        throw new Error(`unexpected pending fixture request ${index}: ${request.responseFormat?.json_schema.name}`);
      }
      return responses[index];
    },
  };
  const result = await createWeeklyPlanningSemanticPipelineV5(createWeeklyPlanningSemanticNormalizerV5(client)).run({
    graph: f.graph, conversationId: EXACT_CONVERSATION, turnId, expectedRevision: f.graph.revision,
    userText: EXACT_TEXT, publicStateSummary: { pendingQuestion: exactPendingQuestion(f) },
    schedulerContext: { ownerId: 'exact-workload-owner', currentDate: '2026-10-10',
      planningStartDate: '2026-10-11', planningEndDate: '2026-10-17', timeZone: 'Asia/Tokyo' },
  });
  expect(f.graph).toEqual(before);
  expect(document).toEqual(documentBefore);
  expect(calls.length).toBeLessThanOrEqual(3);
  expect(calls[0]?.responseFormat?.json_schema.name).toBe('weekly_planning_focused_contextual_answer_v5');
  expect(calls.slice(1).map(call => call.responseFormat?.json_schema.name)).toEqual(
    calls.slice(1).map(() => 'weekly_planning_semantic_document_v5'),
  );
  if (calls.length === 3) expect(calls[2].messages).toContainEqual({ role: 'assistant', content: raw });
  return { result, calls };
}

describe('Stable V5 explicit workload references at the pending-value binder boundary', () => {
  it('preserves the existing local task-shell short-answer binding to pending A', async () => {
    const f = exactFixture();
    const { result, calls } = await runPendingDurationReading(f, durationReading(f, 'reply-task'), 'pending-local-control');
    expect(result.normalization.status).toBe('accepted');
    expect(result.normalization.document?.tasks[0].effortEstimates[0]).toMatchObject({
      targetLocalId: 'reply-task', kind: 'total_duration', minutes: 30, unitCode: null,
    });
    expect(calls).toHaveLength(2);
    expect(result.canonicalization?.status).toBe('applied');
    expect(result.graph.workloads).toEqual(f.graph.workloads);
    expect(result.graph.effortEstimates).toEqual([expect.objectContaining({
      taskId: f.own, targetFactId: f.a, kind: 'total_duration', minutes: 30, unitCode: null,
      source: expect.objectContaining({ semanticLocalId: 'contextual-effort-answer', sourceText: EXACT_TEXT }),
    })]);
    expect(result.graph.revision).toBe(f.graph.revision + 1);
    expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(result.graph)).graph).toEqual(result.graph);
  });

  it.each(PENDING_REFERENCE_CASES)('retains $name through actual generic adoption and canonical binding', async ({ key, kind, name }) => {
    const f = exactFixture();
    const target = f[key];
    const { result, calls } = await runPendingDurationReading(f, durationReading(f, target, kind), name);
    // Main rejects before this point; after reference admission, this is the
    // end-to-end oracle that the prospective direct-owner rows cannot replace.
    expectAcceptedExactTarget({ result, original: f.graph, targetFactId: target, kind });
    expect(result.normalization.document?.tasks[0].effortEstimates[0].targetLocalId).toBe(target);
    expect(calls.map(call => call.responseFormat?.json_schema.name)).toEqual([
      'weekly_planning_focused_contextual_answer_v5', 'weekly_planning_semantic_document_v5',
    ]);
    expect(result.graph.effortEstimates[0].source.semanticLocalId).toBe('reply-effort');
  });

  it.each(PENDING_REFERENCE_CASES)('does not let the value-only owner consume $name', ({ key, kind, name }) => {
    const f = exactFixture();
    const before = structuredClone(f.graph);
    const document = durationReading(f, f[key], kind);
    // Prospective owner-unit boundary only. This is deliberately NOT a fake
    // normalizer accepted result, nor proof that main admits this public target.
    const evaluation = evaluateWeeklyPlanningStableV5ContextualAnswer({
      graph: f.graph, document, pendingQuestion: exactPendingQuestion(f),
      conversationId: EXACT_CONVERSATION, turnId: `owner-${name}`, expectedRevision: f.graph.revision,
      userText: EXACT_TEXT,
    });
    expect(f.graph).toEqual(before);
    expect(evaluation.status, JSON.stringify({ status: evaluation.status, reason: evaluation.reason,
      actualEfforts: evaluation.result?.graph.effortEstimates }, null, 2)).toBe('not_contextual');
    expect(evaluation.result).toBeNull();
  });
});

function nestedExactFixture() {
  const own = exactTask('nested-math', '数学');
  own.decompositionStatus = 'decomposed';
  own.sourceText = '数学教材の12ページと18ページを進めます';
  own.workloads = [exactWorkload('nested-b', 18, '18ページ')];
  own.study!.components = [{
    localId: 'nested-component', existingPublicId: null, parentLocalId: null,
    role: 'material', label: '数学教材', workloads: [exactWorkload('nested-a', 12, '数学教材の12ページ')],
    durableContextSignals: [], sourceText: '数学教材',
  }];
  const other = exactTask('nested-english', '英語');
  other.workloads = [exactWorkload('nested-c', 9, '英語の9ページ')];
  const setup = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    document: exactDocument([own, other]),
    context: { conversationId: EXACT_CONVERSATION, turnId: 'nested-setup', expectedRevision: 0 },
  });
  if (setup.status !== 'applied') throw new Error(setup.errors.join(','));
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(setup.graph)).graph).toEqual(setup.graph);
  const id = (localId: string) => {
    const value = setup.localToFactId[localId];
    if (!value) throw new Error(`missing nested fixture ID: ${localId}`);
    return value;
  };
  return { graph: setup.graph, own: id('nested-math'), other: id('nested-english'),
    a: id('nested-a'), b: id('nested-b'), c: id('nested-c'), component: id('nested-component') };
}

function nestedReplayReading(f: ReturnType<typeof nestedExactFixture>) {
  const document = durationReading(f, 'nested-replayed-workload');
  const fact = f.graph.workloads.find(item => item.id === f.a)!;
  document.tasks[0].decompositionStatus = 'decomposed';
  document.tasks[0].study!.components = [{
    localId: 'nested-replayed-component', existingPublicId: f.component, parentLocalId: null,
    role: 'material', label: '数学教材', workloads: [exactWorkload('nested-replayed-workload', fact.amount, fact.source.sourceText)],
    durableContextSignals: [], sourceText: '数学教材',
  }];
  return document;
}

function expectNoActiveEffortReferencesTerminalOwner(graph: WeeklyPlanningFactGraphV5) {
  const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  for (const effort of graph.effortEstimates.filter(item => active.has(item.id))) {
    expect(active.has(effort.taskId)).toBe(true);
    expect(active.has(effort.targetFactId)).toBe(true);
    const workload = graph.workloads.find(item => item.id === effort.targetFactId);
    if (workload?.componentId) expect(active.has(workload.componentId)).toBe(true);
  }
  expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
}

describe('Stable V5 exact workload references across the existing correction transaction', () => {
  it('retains a direct nested workload target without restating or relocating its component', async () => {
    const f = nestedExactFixture();
    const document = durationReading(f, f.a);
    const { result, calls } = await runDurationReadings({ graph: f.graph, documents: [document, document], turnId: 'nested-exact' });
    expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics, null, 2)).toBe('accepted');
    expect(result.canonicalization?.status).toBe('applied');
    expect(calls).toHaveLength(1);
    expect(result.graph.tasks).toEqual(f.graph.tasks);
    expect(result.graph.components).toEqual(f.graph.components);
    expect(result.graph.workloads).toEqual(f.graph.workloads);
    expect(result.graph.effortEstimates).toEqual([expect.objectContaining({ taskId: f.own, targetFactId: f.a, kind: 'total_duration' })]);
    expectNoActiveEffortReferencesTerminalOwner(result.graph);
  });

  it.each(['workload', 'task', 'component'] as const)('rolls back removing the exact target or its %s owner with active dependents', async targetKind => {
    const f = nestedExactFixture();
    const targetId = targetKind === 'workload' ? f.a : targetKind === 'task' ? f.own : f.component;
    const correctionText = '数学教材の指定対象を削除します';
    for (const [representation, document] of [
      ['local-control', nestedReplayReading(f)], ['exact-public', durationReading(f, f.a)],
    ] as const) {
      document.corrections = [{ localId: 'remove-exact-owner', operation: 'remove',
        target: { kind: targetKind, publicId: targetId, localId: null, mention: null },
        replacementLocalId: null, sourceText: correctionText }];
      const { result } = await runDurationReadings({ graph: f.graph, documents: [document, document],
        turnId: `remove-${targetKind}-${representation}`, userText: `${EXACT_TEXT} ${correctionText}` });
      expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics, null, 2)).toBe('accepted');
      expect(result.canonicalization?.status).toBe('rejected');
      expect(result.canonicalization?.errors).toEqual([expect.stringContaining(`target-has-active-dependents:${targetId}:`)]);
      expect(result.canonicalization?.diff).toBeNull();
      expect(result.graph).toEqual(f.graph);
      expectNoActiveEffortReferencesTerminalOwner(result.graph);
    }
  });

  it.each(DURATION_KINDS)('keeps the existing %s dependent policy when the referenced workload is replaced in the same turn', async kind => {
    const f = exactFixture();
    const correctionText = '数学の12ページを23ページに変更します';
    for (const [representation, document] of [
      ['local-control', replayReading(f, f.a, kind)], ['exact-public', durationReading(f, f.a, kind)],
    ] as const) {
      document.tasks[0].workloads.push(exactWorkload('replacement-workload', 23, correctionText));
      document.corrections = [{ localId: 'replace-exact-workload', operation: 'replace',
        target: { kind: 'workload', publicId: f.a, localId: null, mention: null },
        replacementLocalId: 'replacement-workload', sourceText: correctionText }];
      const { result } = await runDurationReadings({ graph: f.graph, documents: [document, document],
        turnId: `replace-${kind}-${representation}`, userText: `${EXACT_TEXT} ${correctionText}` });
      expect(result.normalization.status, JSON.stringify(result.normalization.diagnostics, null, 2)).toBe('accepted');
      expect(result.canonicalization?.status, JSON.stringify(result.canonicalization?.errors)).toBe('applied');
      const replacementId = result.canonicalization!.localToFactId['replacement-workload'];
      const initialEffortId = result.canonicalization!.localToFactId['reply-effort'];
      expect(result.graph.factLifecycles).toContainEqual(expect.objectContaining({ factId: f.a, status: 'superseded', supersededByFactId: replacementId }));
      expect(result.graph.workloads.find(item => item.id === replacementId)).toMatchObject({ taskId: f.own, amount: 23, unitCode: 'page' });
      const active = createWeeklyPlanningActiveSchedulerGraphViewV5(result.graph);
      expect(active.workloads.some(item => item.id === f.a)).toBe(false);
      expect(active.workloads.some(item => item.id === replacementId)).toBe(true);
      expect(result.graph.factLifecycles.find(entry => entry.factId === initialEffortId)?.status).toBe(kind === 'total_duration' ? 'removed' : 'superseded');
      if (kind === 'total_duration') expect(active.effortEstimates).toEqual([]);
      else expect(active.effortEstimates).toEqual([expect.objectContaining({
        taskId: f.own, targetFactId: replacementId, kind: 'session_duration', minutes: 30,
        // Existing CorrectionTransaction carry policy assigns the replacement unit.
        unitCode: 'page', source: expect.objectContaining({ sourceText: EXACT_TEXT }),
      })]);
      expectNoActiveEffortReferencesTerminalOwner(result.graph);
    }
  });
});


describe('Stable V5 direct canonicalizer full-document collision boundary', () => {
  it('rejects a user-context local ID shadowing the external workload without throwing or committing', () => {
    const f = exactFixture();
    const document = durationReading(f, f.a);
    document.userContextFacts = [{ localId: f.a, kind: 'concern', label: '数学', value: '数学',
      dateExpression: null, sourceText: EXACT_TEXT }];
    const before = structuredClone(f.graph);
    const docBefore = structuredClone(document);
    const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: f.graph, document,
      context: { conversationId: EXACT_CONVERSATION, turnId: 'context-local-shadow',
        expectedRevision: f.graph.revision, userText: EXACT_TEXT },
    });
    expect(result.status).toBe('rejected');
    expect(result.errors).toContain(EXACT_TARGET_ERROR);
    expect(result.graph).toEqual(before);
    expect(result.diff).toBeNull();
    expect(f.graph).toEqual(before);
    expect(document).toEqual(docBefore);
  });
});


describe('Stable V5 raw local-reference authority before duplicate cleanup', () => {
  it('does not revive an erased declared workload local ID as an external public target', () => {
    const f = exactFixture();
    const document = durationReading(f, f.a);
    const duplicate = exactWorkload(f.a, 12, '数学の12ページ');
    document.tasks[0].workloads = [duplicate];
    document.tasks[0].decompositionStatus = 'decomposed';
    document.tasks[0].study!.components = [{ localId: 'collision-component', existingPublicId: null,
      parentLocalId: null, role: 'material', label: '数学教材',
      workloads: [{ ...duplicate, localId: 'kept-nested-workload' }],
      durableContextSignals: [], sourceText: '数学教材' }];
    const raw = JSON.stringify(document);
    const attempt = validateWeeklyPlanningSemanticResponseV5(raw, {
      committedGraph: f.graph, currentUserText: `${EXACT_TEXT} 数学教材の12ページ`,
    });
    // The actual pre-parse owner removed the declaring task-level workload.
    expect(attempt.algorithmicRepairs).toContain(`duplicate-workload-removed-from-task:reply-task:${f.a}`);
    expect(attempt.errors).toContain(EXACT_TARGET_ERROR);
    expect(attempt.parsedDocument).toBeNull();
    expect(attempt.document).toBeNull();
    expect(JSON.stringify(document)).toBe(raw);
    // This assertion concerns this raw input only; externally cleaned JSON is
    // a different input and is not claimed to be an idempotent rejected replay.
  });
});
