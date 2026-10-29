import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import { executeWeeklyPlanningStableV5SemanticTurnCore } from '../application/weeklyPlanningStableV5SemanticTurnCore';
import { createWeeklyPlanningTurnRequestContext } from '../application/weeklyPlanningTemporalContext';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticDocumentV5, SemanticWorkloadV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';
import { validateWeeklyPlanningCorrectionTargetReferencesV5, validateWeeklyPlanningRawCorrectionTargetReferencesV5 } from './weeklyPlanningCorrectionReferenceValidationV5';
import { validateWeeklyPlanningSemanticRepairPreservationV5 } from './weeklyPlanningSemanticRepairPreservationV5';
import { createWeeklyPlanningSemanticRepairMessagesV5 } from './weeklyPlanningSemanticRepairPromptV5';
import { createWeeklyPlanningStableV5FailureDiagnostics } from './weeklyPlanningStableV5FailureDiagnostics';
import iter1 from './__fixtures__/issue882/c-turn3-iter1.json';
import iter2 from './__fixtures__/issue882/c-turn3-iter2.json';
import iter4 from './__fixtures__/issue882/c-turn3-iter4.json';
import iter5 from './__fixtures__/issue882/c-turn3-iter5.json';
import iter7 from './__fixtures__/issue882/c-turn3-iter7.json';
import iter8 from './__fixtures__/issue882/c-turn3-iter8.json';
import iter9 from './__fixtures__/issue882/c-turn3-iter9.json';
import iter10 from './__fixtures__/issue882/c-turn3-iter10.json';

interface ReplayFixture {
  iteration: number;
  priorGraph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  userText: string;
  conversationId: string;
  turnId: string;
  expectedArtifactActiveWorkloads: WeeklyPlanningFactGraphV5['workloads'];
  expectedArtifactRevision: number;
}

// Recorded run 40713796128, FinalConversation C turn 3. Synthetic study utterances
// and machine IDs only; unused expected-graph history was omitted on import.
const fixtures = [iter1, iter2, iter4, iter5, iter7, iter8, iter9, iter10] as unknown as ReplayFixture[];
const mismatch = 'document.corrections[0]:workload-basis-mismatch:unitCode';
const context = { ownerId: 'owner-test', currentDate: '2026-10-29', planningStartDate: '2026-10-30',
  planningEndDate: '2026-10-30', timeZone: 'Asia/Tokyo', namedTimePeriods: {} };

function fixture(index = 0): ReplayFixture {
  return structuredClone(fixtures[index]);
}

function activeWorkloads(graph: WeeklyPlanningFactGraphV5) {
  const active = new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
  return graph.workloads.filter(workload => active.has(workload.id));
}

function normalizer(responses: unknown[]) {
  const createChatCompletion = vi.fn<OpenAiCompatibleClient['createChatCompletion']>(async () => {
    if (responses.length === 0) throw new Error('Unexpected extra provider call');
    return JSON.stringify(responses.shift());
  });
  return { normalizer: createWeeklyPlanningSemanticNormalizerV5({ createChatCompletion }), createChatCompletion };
}

function runReplay(fx: ReplayFixture, replies: unknown[]) {
  const mock = normalizer(replies);
  return { ...mock, result: createWeeklyPlanningSemanticPipelineV5(mock.normalizer).run({
    graph: fx.priorGraph, userText: fx.userText, conversationId: fx.conversationId,
    turnId: fx.turnId, expectedRevision: fx.priorGraph.revision, schedulerContext: context,
  }) };
}

function repairedValue(fx: ReplayFixture) {
  const document = structuredClone(fx.document);
  document.tasks[0].workloads[0].unitCode = 'custom';
  return document;
}

describe('U1 recorded workload value corrections', () => {
  it.each(fixtures.map((fx, index) => [fx.iteration, index]))('replays iteration %i through validation, single repair and commit', async (iteration, index) => {
    const fx = fixture(index);
    const before = structuredClone(fx.priorGraph);
    const needsRepair = iteration === 1 || iteration === 4;
    const validation = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(fx.document), {
      currentUserText: fx.userText,
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, fx.priorGraph),
      committedGraph: fx.priorGraph,
    });
    expect(validation.errors).toEqual(needsRepair ? [mismatch] : []);
    expect(Boolean(validation.document)).toBe(!needsRepair);
    const replay = runReplay(fx, needsRepair ? [fx.document, repairedValue(fx)] : [fx.document]);
    const result = await replay.result;
    expect(result.status).toBe('scheduler_needs_resolution');
    expect(result.normalization.status).toBe('accepted');
    expect(replay.createChatCompletion).toHaveBeenCalledTimes(needsRepair ? 2 : 1);
    expect(result.normalization.diagnostics.repairAttempted).toBe(needsRepair);
    const workloads = activeWorkloads(result.graph);
    expect(workloads.filter(w => w.quantityRole === 'completed').map(w => w.amount)).toEqual([12]);
    expect(workloads.filter(w => w.quantityRole === 'remaining').map(w => w.amount)).toEqual([8]);
    if (!needsRepair) {
      expect(workloads).toEqual(fx.expectedArtifactActiveWorkloads);
      expect(result.graph.revision).toBe(fx.expectedArtifactRevision);
    }
    expect(fx.priorGraph).toEqual(before);
  });

  it.each([0, 2])('rejects failed repair for fixture %i without committing C12 beside stale R10', async index => {
    const fx = fixture(index);
    const replay = runReplay(fx, [fx.document, fx.document]);
    const result = await replay.result;
    expect(result.status).toBe('normalization_rejected');
    expect(result.canonicalization).toBeNull();
    expect(result.scheduler).toBeNull();
    expect(result.graph).toBe(fx.priorGraph);
    expect(activeWorkloads(result.graph).filter(w => w.quantityRole === 'completed').map(w => w.amount)).toEqual([10]);
    expect(result.normalization.diagnostics).toMatchObject({ attemptCount: 2, repairAttempted: true });
    expect(replay.createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('does not coerce a true counting-unit change into the old unit', async () => {
    const fx = fixture();
    fx.userText = '訂正です、枚数ではなくページ数で数えます。今は12ページまでできています';
    fx.document.tasks[0].sourceText = fx.userText;
    fx.document.tasks[0].workloads[0].sourceText = '今は12ページまでできています';
    fx.document.tasks[0].workloads[0].unitLabel = 'ページ';
    fx.document.corrections[0].sourceText = fx.userText;
    // The recorded model decision preserves its new counting meaning after repair.
    // Code must reject the value-only shape, never rewrite page back to custom.
    const replay = runReplay(fx, [fx.document, fx.document]);
    const result = await replay.result;
    expect(result.status).toBe('normalization_rejected');
    expect(result.graph).toBe(fx.priorGraph);
    expect(fx.document.tasks[0].workloads[0].unitCode).toBe('page');
    const repairMessages = replay.createChatCompletion.mock.calls[1][0].messages;
    const repairMessage = repairMessages[repairMessages.length - 1]?.content ?? '';
    expect(repairMessage).toContain('do not force it into the old unit');
  });
});

const changedFields: Array<[keyof SemanticWorkloadV5, unknown]> = [
  ['quantityRole', 'remaining'], ['unitCode', 'page'], ['unitLabel', 'ページ'],
  ['rangeStart', '1'], ['rangeEnd', '20'], ['perOccurrence', true], ['periodExpression', '毎日'],
];
const references = ['public-task', 'local-task', 'public-component', 'local-component'] as const;

describe('U1 raw and typed correction reference shape', () => {
  it.each([
    ['target', 'replace'], ['target', 'modify'], ['remaining', 'replace'], ['remaining', 'modify'],
  ] as const)('preserves ordinary %s hour-to-minute %s corrections', async (quantityRole, operation) => {
    const fx = fixture();
    const original = fx.priorGraph.workloads.find(w => w.quantityRole === 'completed')!;
    const removed = new Set(fx.priorGraph.workloads.filter(w => w !== original).map(w => w.id));
    fx.priorGraph.workloads = [{ ...original, quantityRole, amount: quantityRole === 'target' ? 3 : 2,
      unitCode: 'hour', unitLabel: '時間' }];
    fx.priorGraph.factLifecycles = fx.priorGraph.factLifecycles.filter(entry => !removed.has(entry.factId));
    fx.userText = quantityRole === 'target' ? '訂正です、スライドは3時間ではなく90分です' : '訂正です、残り2時間ではなく残り90分です';
    fx.document.tasks[0].sourceText = fx.userText;
    Object.assign(fx.document.tasks[0].workloads[0], { quantityRole, amount: 90, unitCode: 'minute',
      unitLabel: '分', sourceText: fx.userText });
    fx.document.corrections[0].sourceText = fx.userText;
    fx.document.corrections[0].operation = operation;
    const replay = runReplay(fx, [fx.document]);
    const result = await replay.result;
    expect(result.normalization.status).toBe('accepted');
    expect(result.canonicalization?.status).toBe('applied');
    expect(activeWorkloads(result.graph).map(w => [w.quantityRole, w.amount, w.unitCode])).toEqual([
      [quantityRole, 90, 'minute'],
    ]);
    expect(replay.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('checks scope-total value correction shape as well as completed progress', () => {
    const fx = fixture();
    const original = fx.priorGraph.workloads.find(w => w.id === fx.document.corrections[0].target.publicId)!;
    original.quantityRole = 'scope_total';
    fx.document.tasks[0].workloads[0].quantityRole = 'scope_total';
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(fx.document,
      createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, fx.priorGraph))).toEqual([mismatch]);
  });

  for (const reference of references) {
    it.each(changedFields)(`${reference} validates %s for replace and modify`, (field, changedValue) => {
      const fx = fixture();
      const document = repairedValue(fx);
      const task = document.tasks[0];
      const original = { ...task.workloads[0], localId: 'old-local', amount: 10 };
      if (reference.startsWith('local')) {
        task.workloads.unshift(original);
        document.corrections[0].target = { kind: 'workload', publicId: null, localId: original.localId, mention: null };
      }
      const replacement = task.workloads[task.workloads.length - 1];
      Object.assign(replacement, { [field]: changedValue });
      if (reference.endsWith('component')) {
        task.category = 'study';
        task.study = { purpose: 'self_study', contextLabel: null, components: [{
          localId: 'component', existingPublicId: null, parentLocalId: null, role: 'material',
          label: 'スライド', workloads: task.workloads, sourceText: fx.userText,
        }] };
        task.workloads = [];
      }
      const summary = createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, fx.priorGraph);
      for (const operation of ['replace', 'modify'] as const) {
        document.corrections[0].operation = operation;
        const errors = [`document.corrections[0]:workload-basis-mismatch:${field}`];
        expect(validateWeeklyPlanningCorrectionTargetReferencesV5(document, summary)).toEqual(errors);
        expect(validateWeeklyPlanningRawCorrectionTargetReferencesV5(JSON.stringify(document), summary)).toEqual(errors);
      }
      Object.assign(replacement, { [field]: original[field] });
      expect(validateWeeklyPlanningCorrectionTargetReferencesV5(document, summary)).toEqual([]);
      expect(validateWeeklyPlanningRawCorrectionTargetReferencesV5(JSON.stringify(document), summary)).toEqual([]);
    });
  }

  it('also detects page to custom drift despite identical unit labels', () => {
    const fx = fixture(3); // iteration 5 accepted page
    fx.document.tasks[0].workloads[0].unitCode = 'custom';
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(fx.document,
      createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, fx.priorGraph))).toEqual([mismatch]);
  });

  it('reports workload shape together with unrelated schema errors before the only repair', () => {
    const fx = fixture();
    fx.document.tasks[0].category = 'study'; // study remains null: independent schema failure
    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(fx.document), {
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, fx.priorGraph),
    });
    expect(result.document).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining(['document.tasks[0].study:required', mismatch]));
  });
});

describe('U1 bounded repair preservation', () => {
  it.each(['amount', 'target', 'replacement', 'unaddressed-shape', 'other-clause', 'drop-correction'] as const)(
    'rejects repair mutation outside the addressed field: %s', async change => {
      const fx = fixture();
      const independent = { ...fx.document.tasks[0].workloads[0], localId: 'independent',
        quantityRole: 'target' as const, amount: 3, unitCode: 'problem' as const, unitLabel: '問' };
      fx.document.tasks[0].workloads.push(independent);
      const repaired = repairedValue(fx);
      if (change === 'amount') repaired.tasks[0].workloads[0].amount = 999;
      if (change === 'target') repaired.corrections[0].target.publicId = fx.priorGraph.workloads[0].id;
      if (change === 'replacement') repaired.corrections[0].replacementLocalId = 'independent';
      if (change === 'unaddressed-shape') repaired.tasks[0].workloads[0].quantityRole = 'remaining';
      if (change === 'other-clause') repaired.tasks[0].workloads[1].amount = 999;
      if (change === 'drop-correction') repaired.corrections = [];
      const replay = runReplay(fx, [fx.document, repaired]);
      const result = await replay.result;
      expect(result.status).toBe('normalization_rejected');
      expect(result.graph).toBe(fx.priorGraph);
      expect(result.normalization.diagnostics.validationErrors).toContain(
        'repair:semantic-repair-preservation:representation-only repair changed unrelated semantic facts');
      expect(replay.createChatCompletion).toHaveBeenCalledTimes(2);
    });

  it('allows only the addressed workload and date fields in the same repair', async () => {
    const fx = fixture();
    fx.userText += '。締切は10月30日です';
    fx.document.tasks[0].temporalConstraints.push({ localId: 'deadline', targetLocalId: 'task_slides',
      kind: 'deadline', constraintLevel: 'hard', dateExpression: '2026/10/30', namedTimePeriod: null,
      startTime: null, endTime: null, precision: 'exact', sourceText: '締切は10月30日です' });
    const repaired = repairedValue(fx);
    repaired.tasks[0].temporalConstraints[0].dateExpression = '2026-10-30';
    const replay = runReplay(fx, [fx.document, repaired]);
    const result = await replay.result;
    expect(result.normalization.status).toBe('accepted');
    expect(result.normalization.diagnostics.validationErrors).toEqual(expect.arrayContaining([
      mismatch, 'document.tasks[0].temporalConstraints[0].dateExpression:canonical-expression',
    ]));
    expect(activeWorkloads(result.graph).filter(w => w.quantityRole === 'remaining').map(w => w.amount)).toEqual([8]);
    expect(replay.createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('repairs a missing schema field in another clause while preserving its quantity', async () => {
    const fx = fixture();
    fx.userText += '。英語小テストを2問進めます';
    const independent = structuredClone(fx.document.tasks[0]);
    independent.localId = 'english-task';
    independent.existingPublicId = null;
    independent.title = '英語小テスト';
    independent.sourceText = '英語小テストを2問進めます';
    independent.workloads = [{ ...independent.workloads[0], localId: 'english-target',
      quantityRole: 'target', amount: 2, unitCode: 'problem', unitLabel: '問', sourceText: independent.sourceText }];
    fx.document.tasks.push(independent);
    const repaired = repairedValue(fx);
    delete (independent as Partial<typeof independent>).title;
    const replay = runReplay(fx, [fx.document, repaired]);
    const result = await replay.result;
    expect(result.normalization.status).toBe('accepted');
    expect(result.normalization.diagnostics.validationErrors).toEqual(expect.arrayContaining([
      mismatch, 'document.tasks[1].missing-key:title',
    ]));
    expect(activeWorkloads(result.graph).filter(w => w.quantityRole === 'remaining').map(w => w.amount)).toEqual([8]);
    expect(activeWorkloads(result.graph).filter(w => w.quantityRole === 'target').map(w => w.amount)).toEqual([2]);
    expect(replay.createChatCompletion).toHaveBeenCalledTimes(2);
    const changedQuantity = structuredClone(repaired);
    changedQuantity.tasks[1].workloads[0].amount = 999;
    const rejected = await runReplay(fx, [fx.document, changedQuantity]).result;
    expect(rejected.status).toBe('normalization_rejected');
    expect(rejected.graph).toBe(fx.priorGraph);
  });

  it('fails closed if the comparison envelope is unavailable', () => {
    expect(validateWeeklyPlanningSemanticRepairPreservationV5({
      initialDocument: null, repairedDocument: repairedValue(fixture()), initialErrors: [mismatch],
    })).toEqual(['semantic-repair-preservation:comparison-document-unavailable']);
  });

  it('instructs repair to preserve the value, target and other clauses while respecting true unit changes', () => {
    const messages = createWeeklyPlanningSemanticRepairMessagesV5({ baseMessages: [], invalidResponse: '{}',
      validationErrors: [mismatch, 'document.tasks[0].study:required'] });
    const content = messages[messages.length - 1].content;
    for (const text of ['value-only correction', 'quantityRole', 'rangeStart/rangeEnd', 'perOccurrence',
      'periodExpression', 'preserve amount', 'correction target', 'unrelated clauses', 'do not force',
      'Correct every listed validation failure']) expect(content).toContain(text);
  });

  it('returns neutral unreflected-change guidance and classified diagnostics after failed repair', async () => {
    const fx = fixture();
    const mock = normalizer([fx.document, { ...repairedValue(fx), tasks: [] }]);
    const recordFailure = vi.fn();
    const graphBefore = structuredClone(fx.priorGraph);
    const result = await executeWeeklyPlanningStableV5SemanticTurnCore({
      messages: [], userText: fx.userText, selectedDate: '2026-10-29', userId: 'owner-test', plans: [],
      scheduleTemplates: [], conversationId: fx.conversationId, traceRequestId: fx.turnId,
      requestContext: createWeeklyPlanningTurnRequestContext({
        startedAtIso: '2026-10-29T09:42:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
      }),
    }, { normalizer: mock.normalizer, session: { ownerId: 'owner-test', weekStartDate: '2026-10-26',
      conversationId: fx.conversationId, graph: fx.priorGraph, updatedAt: 0 }, selectContext: () => [], recordFailure });
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') throw new Error('Expected rejection');
    expect(result.output.message).toBe('変更を安全に反映できませんでした。予定条件は変更していません。');
    expect(result.output.draftCandidates).toEqual([]);
    expect(fx.priorGraph).toEqual(graphBefore);
    expect(recordFailure).toHaveBeenCalledOnce();
    const diagnostics = createWeeklyPlanningStableV5FailureDiagnostics(recordFailure.mock.calls[0][0]);
    expect(diagnostics.validationErrorCategories).toEqual(expect.arrayContaining([
      'workload_correction_reference', 'repair_preservation',
    ]));
    expect(diagnostics.repairAttempted).toBe(true);
    expect(mock.createChatCompletion).toHaveBeenCalledTimes(2);
  });
});
