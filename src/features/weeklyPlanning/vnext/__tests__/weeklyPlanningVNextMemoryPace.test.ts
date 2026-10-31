import { describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../../../../types/domain';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import type { WeeklyPlanDraftBlock } from '../../types';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../../semantic/weeklyPlanningFactGraphV5';
import { deriveWeeklyPlanningMemoryPaceEstimateV5 } from '../../personalization/weeklyPlanningMemoryPaceObservationsV5';
import {
  prepareWeeklyPlanningStableV5Checkpoint,
  serializeWeeklyPlanningStableV5CheckpointWithMessageCount,
} from '../../application/weeklyPlanningStableV5SessionCodec';
import { createInitialPlanningState } from '../../weeklyPlanningReducer';
import type {
  WeeklyPlanningVNextInterpretation,
  WeeklyPlanningVNextInterpretationInput,
} from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import {
  approveWeeklyPlanningVNextExperimentalPreview,
  readWeeklyPlanningVNextExperimentalSession,
  submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope,
} from '../application/weeklyPlanningVNextExperimentalSession';

const OWNER = 'memory-pace-vnext-test';
const WEEK_START = '2026-08-17';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: OWNER,
  weekStartDate: WEEK_START,
  conversationId: 'vnext-memory-pace',
  clock: { currentDate: WEEK_START, planningStartDate: WEEK_START, planningEndDate: '2026-08-23',
    timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
  notBeforeTime: '09:00',
};

const emptyDelta = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const interpreted = (delta: VNextTurnDelta): WeeklyPlanningVNextInterpretation => ({
  status: 'interpreted', delta, answer: null, metrics: { calls: 1, repairs: 0, latencyMs: 1 },
});

function memoryFacts(activityKind: 'memorization_retrieval' | 'problem_solving' | 'unknown' = 'memorization_retrieval',
  explicit: 'rate' | 'total' | null = null): VNextAddFact[] {
  const task: VNextAddFact = { kind: 'task', localId: 'vocabulary', category: 'study', title: '英単語' };
  const study: VNextAddFact = { kind: 'study_context', localId: 'study', taskRef: { localId: 'vocabulary' },
    purpose: 'self_study', contextLabel: '英単語', activityKind };
  const work: VNextAddFact = { kind: 'workload', localId: 'words', taskRef: { localId: 'vocabulary' }, componentRef: null,
    quantityRole: 'target', amount: 35, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null };
  if (!explicit) return [task, study, work];
  return [task, study, work, {
    kind: 'effort_estimate', localId: 'explicit-estimate', taskRef: { localId: 'vocabulary' },
    targetRef: { localId: 'words' }, effortKind: explicit === 'rate' ? 'duration_per_unit' : 'total_duration',
    minutes: explicit === 'rate' ? 2 : 45, unitCode: explicit === 'rate' ? 'word' : null,
    unitLabel: null, precision: 'exact',
  }];
}

function calibrationPlan(): Plan {
  return {
    id: 'memory-calibration-plan', seriesId: 'memory-calibration-plan', userId: OWNER,
    title: '英単語のペース計測', subject: '英語', date: '2026-08-10',
    startTime: '09:00', endTime: '09:20', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
    weeklyPlanningObservationSource: {
      version: 1, kind: 'memory_pace_calibration', activityKind: 'memorization_retrieval',
      conversationId: 'calibration-conversation', graphRevision: 4, taskId: 'old-task',
      workloadFactId: 'old-workload', sessionEffortFactId: 'old-session-effort',
      unitCode: 'word', unitLabel: '語', targetAmount: 220, plannedSessionMinutes: 20,
    },
  };
}

function calibrationActual(options: {
  planId?: string;
  start?: string;
  end?: string;
  progressAmount?: number;
  resultUnitCode?: string;
  resultUnitLabel?: string;
  aligned?: boolean;
} = {}): Actual {
  return {
    id: 'memory-calibration-actual', userId: OWNER,
    planId: options.planId ?? 'memory-calibration-plan', occurrenceDate: '2026-08-10',
    actualStartTime: options.start ?? '09:00', actualEndTime: options.end ?? '09:20',
    title: '英単語のペース計測', subject: '英語', isAlignedToPlan: options.aligned ?? true,
    note: '', updatedAt: '2026-08-10T10:00:00.000Z',
    weeklyPlanningObservationResult: {
      version: 1, kind: 'memory_pace_calibration', progressAmount: options.progressAmount ?? 35,
      unitCode: options.resultUnitCode ?? 'word', unitLabel: options.resultUnitLabel ?? '語',
    },
  };
}

function customCalibrationPlan(id: string, unitLabel: string, targetAmount: number, plannedSessionMinutes: number): Plan {
  const plan = calibrationPlan();
  return {
    ...plan,
    id,
    seriesId: id,
    weeklyPlanningObservationSource: {
      ...plan.weeklyPlanningObservationSource!,
      conversationId: `calibration-${id}`,
      unitCode: 'custom',
      unitLabel,
      targetAmount,
      plannedSessionMinutes,
    },
  };
}

function customCalibrationActual(id: string, planId: string, unitLabel: string, progressAmount: number,
  durationMinutes: number): Actual {
  const endMinute = 9 * 60 + durationMinutes;
  const actual = calibrationActual({ start: '09:00',
    end: `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`,
    progressAmount, resultUnitCode: 'custom', resultUnitLabel: unitLabel, planId });
  return { ...actual, id };
}

function customUnitFacts(unitLabel: string, amount: number, taskId = `custom-${unitLabel}`): VNextAddFact[] {
  return [
    { kind: 'task', localId: taskId, category: 'study', title: `暗記 ${unitLabel}` },
    { kind: 'study_context', localId: `context-${taskId}`, taskRef: { localId: taskId },
      purpose: 'self_study', contextLabel: `暗記 ${unitLabel}`, activityKind: 'memorization_retrieval' },
    { kind: 'workload', localId: `work-${taskId}`, taskRef: { localId: taskId }, componentRef: null,
      quantityRole: 'target', amount, unitCode: 'custom', unitLabel, rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null },
  ];
}

type Calendar = { plans: readonly Plan[]; actuals: readonly Actual[] };
type ScriptStep = VNextTurnDelta | ((input: WeeklyPlanningVNextInterpretationInput) => VNextTurnDelta);

function harness(script: ScriptStep[], options: { calendar?: Calendar; legacyV5?: string; conversationId?: string } = {}) {
  const sessionScope = { ...scope, conversationId: options.conversationId ?? scope.conversationId };
  const storage = new Map<string, string>();
  if (options.legacyV5) storage.set('v5', options.legacyV5);
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  let saveCalls = 0;
  let shownRevision: number | null = null;
  let declineProposalId: string | null = null;
  const slot = (key: string) => ({
    read: () => storage.get(key) ?? null,
    write: (raw: string) => { storage.set(key, raw); },
  });
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client: {} as OpenAiCompatibleClient,
    async interpret(input) {
      if (declineProposalId) {
        const proposalId = declineProposalId;
        declineProposalId = null;
        return { ...interpreted(emptyDelta()), answer: { kind: 'proposal_decision', proposalId, decision: 'reject' } };
      }
      const step = script.shift();
      if (!step) throw new Error('VNext memory-pace script exhausted');
      return interpreted(typeof step === 'function' ? step(input) : step);
    },
    checkpoint: slot('vnext'),
    legacyV5Checkpoint: { read: slot('v5').read },
    approvalLedger: slot('ledger'),
    plans: {
      async findExistingPlanId(sourceDraftBlockId) {
        return saved.has(sourceDraftBlockId) ? `plan:${sourceDraftBlockId}` : undefined;
      },
      async saveBlock(block) {
        saveCalls += 1;
        saved.set(block.id, block);
        return { planId: `plan:${block.id}` };
      },
    },
    calendar: () => ({ plans: options.calendar?.plans ?? [], actuals: options.calendar?.actuals ?? [],
      monthEvents: [], scheduleTemplates: [] }),
    createRenderer: () => ({ async render(input) {
      return { status: 'rendered', text: `rendered:${input.actionKind}`, rawResponse: '' };
    } }),
    now: () => '2026-08-17T00:00:00.000Z',
  };
  return {
    ports, scope: sessionScope, storage, saved, saveCalls: () => saveCalls,
    async turn(turnId: string, userText: string) {
      let result = await submitWeeklyPlanningVNextExperimentalTurn({
        scope: sessionScope, ports, turnId, userText, shownRevision,
      });
      if (result.graphRevision !== null) shownRevision = result.graphRevision;
      // These fixtures isolate observed pace, not session-strategy adoption. V5 also offers
      // spacing with known pace (MemoryObservedPaceConversationV5: "uses observed pace…").
      // Decline it explicitly through the shown question, binder, transaction and checkpoint.
      if (result.question?.code === 'learning_strategy_proposal') {
        expect(result.question.proposal).toMatchObject({ kind: 'spaced_memory_practice', status: 'pending' });
        declineProposalId = result.question.proposal!.id;
        result = await submitWeeklyPlanningVNextExperimentalTurn({ scope: sessionScope, ports,
          turnId: `${turnId}:decline-spacing`, userText: '間隔を空ける提案は今回は使いません', shownRevision });
        if (result.graphRevision !== null) shownRevision = result.graphRevision;
      }
      return result;
    },
  };
}

const memoryDelta = (activityKind: 'memorization_retrieval' | 'problem_solving' | 'unknown' = 'memorization_retrieval',
  explicit: 'rate' | 'total' | null = null): VNextTurnDelta => ({ ...emptyDelta(), add: memoryFacts(activityKind, explicit) });

function estimatedPreviewMinutes(blocks: readonly WeeklyPlanDraftBlock[]): number {
  return blocks.reduce((total, block) => total + (block.allocationBreakdown?.estimatedMinutes ?? 0), 0);
}

type InvalidEvidenceCase = {
  name: string;
  calendar: Calendar;
  activityKind?: 'memorization_retrieval' | 'problem_solving' | 'unknown';
};

const ordinaryPlan = (): Plan => ({ ...calibrationPlan(), id: 'unrelated-plan', seriesId: 'unrelated-plan', weeklyPlanningObservationSource: undefined });
const invalidEvidenceCases: InvalidEvidenceCase[] = [
  { name: 'off-plan actual result', calendar: { plans: [ordinaryPlan()], actuals: [calibrationActual({ planId: 'unrelated-plan' })] } },
  { name: 'unaligned actual result', calendar: { plans: [calibrationPlan()], actuals: [calibrationActual({ aligned: false })] } },
  { name: 'zero progress', calendar: { plans: [calibrationPlan()], actuals: [calibrationActual({ progressAmount: 0 })] } },
  { name: 'zero-duration actual', calendar: { plans: [calibrationPlan()], actuals: [calibrationActual({ start: '09:00', end: '09:00' })] } },
  { name: 'mismatched actual unit', calendar: { plans: [calibrationPlan()], actuals: [calibrationActual({ resultUnitCode: 'page', resultUnitLabel: 'ページ' })] } },
  { name: 'non-memorization activity', calendar: { plans: [calibrationPlan()], actuals: [calibrationActual()] }, activityKind: 'problem_solving' },
  { name: 'unknown activity', calendar: { plans: [calibrationPlan()], actuals: [calibrationActual()] }, activityKind: 'unknown' },
  { name: 'no actual results', calendar: { plans: [calibrationPlan()], actuals: [] } },
];

function legacyV5CheckpointWithMemoryContext(conversationId: string): string {
  const source = (semanticLocalId: string) => ({
    conversationId, turnId: 'v5', semanticLocalId, sourceText: '英単語35語', origin: 'user' as const,
  });
  const factIds = ['memory-task', 'memory-study', 'memory-work'];
  const graph: WeeklyPlanningFactGraphV5 = {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 2,
    tasks: [{ id: factIds[0], category: 'study', title: '英単語', createdRevision: 1, source: source('task') }],
    studyContexts: [{ id: factIds[1], taskId: factIds[0], purpose: 'self_study', contextLabel: '英単語',
      createdRevision: 1, source: source('study') }],
    workloads: [{ id: factIds[2], taskId: factIds[0], componentId: null, quantityRole: 'target', amount: 35,
      unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      createdRevision: 1, source: source('work') }],
    factLifecycles: factIds.map((factId) => ({ factId, status: 'active' as const, createdRevision: 1,
      terminalRevision: null, supersededByFactId: null })),
  };
  const prepared = prepareWeeklyPlanningStableV5Checkpoint({ ownerId: OWNER, weekStartDate: WEEK_START,
    conversationId, graph, planningState: createInitialPlanningState(WEEK_START) });
  if (prepared.status !== 'ready') throw new Error(`Could not prepare V5 memory context checkpoint: ${prepared.status}`);
  return serializeWeeklyPlanningStableV5CheckpointWithMessageCount({ ownerId: OWNER, weekStartDate: WEEK_START,
    conversationId, graph, planningState: prepared.planningState, savedAt: '2026-08-17T00:00:00.000Z', messageCount: 0 })!;
}

describe('VNext observed memory pace through the session and scheduler', () => {
  it('uses aligned validated calibration evidence for memorization work, previews at the V5 pace, then saves/reloads once', async () => {
    const plans = [calibrationPlan()];
    const actuals = [calibrationActual()];
    const h = harness([memoryDelta()], { calendar: { plans, actuals } });
    const result = await h.turn('memory-work', '英単語35語を覚える');

    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(result.preview).not.toBeNull();
    const v5Pace = deriveWeeklyPlanningMemoryPaceEstimateV5({ plans, actuals, unitCode: 'word' });
    expect(v5Pace.medianMinutesPerUnit).toBeCloseTo(20 / 35);
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(35 * v5Pace.medianMinutesPerUnit!);
    const read = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') throw new Error('VNext memory-pace checkpoint did not reload');
    expect(read.checkpoint.state.graph.studyContexts[0].activityKind).toBe('memorization_retrieval');
    expect(read.checkpoint.state.graph.effortEstimates).toEqual([]);

    const approval = await approveWeeklyPlanningVNextExperimentalPreview({ scope: h.scope, ports: h.ports });
    expect(approval).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(h.saved.size).toBe(result.preview!.blocks.length);
    expect(h.saveCalls()).toBe(result.preview!.blocks.length);
    const reloaded = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(reloaded).toMatchObject({ status: 'ready', source: 'vnext', checkpoint: { preview: result.preview } });
    if (reloaded.status === 'ready') expect(reloaded.checkpoint.state.graph.effortEstimates).toEqual([]);
    const saveCalls = h.saveCalls();
    expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope: h.scope, ports: h.ports }))
      .toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(h.saveCalls()).toBe(saveCalls);
  });

  it.each(invalidEvidenceCases)('asks for missing effort with $name', async ({ calendar, activityKind }) => {
    const h = harness([memoryDelta(activityKind)], { calendar });
    const result = await h.turn('invalid-evidence', '英単語35語を覚える');

    expect(result).toMatchObject({ outcome: 'applied', readiness: 'needs_resolution',
      question: { code: 'missing_effort_estimate' }, preview: null });
  });

  it('gives an explicit per-unit estimate precedence over observed pace', async () => {
    const h = harness([memoryDelta('memorization_retrieval', 'rate')], {
      calendar: { plans: [calibrationPlan()], actuals: [calibrationActual()] },
    });
    const result = await h.turn('explicit-rate', '英単語35語、1語あたり2分');

    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(result.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(70);
    const read = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(read.status).toBe('ready');
    if (read.status === 'ready') expect(read.checkpoint.state.graph.effortEstimates).toHaveLength(1);
  });

  it('gives an explicit whole-work total precedence over observed pace', async () => {
    const h = harness([memoryDelta('memorization_retrieval', 'total')], {
      calendar: { plans: [calibrationPlan()], actuals: [calibrationActual()] },
    });
    const result = await h.turn('explicit-total', '英単語35語は全体で45分');

    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(result.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(45);
  });

  it('prices a custom 首 workload from matching custom 首 calibration', async () => {
    const plan = customCalibrationPlan('calibration-head', '首', 10, 20);
    const actual = customCalibrationActual('actual-head', plan.id, '首', 10, 20);
    const h = harness([{ ...emptyDelta(), add: customUnitFacts('首', 10) }], {
      calendar: { plans: [plan], actuals: [actual] },
    });
    const result = await h.turn('custom-head', '10首を暗記する');
    const v5Pace = deriveWeeklyPlanningMemoryPaceEstimateV5({ plans: [plan], actuals: [actual], unitCode: 'custom' });

    expect(v5Pace.medianMinutesPerUnit).toBeCloseTo(2);
    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(result.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(10 * v5Pace.medianMinutesPerUnit!);
  });

  it('does not use custom 首 calibration to price custom 項目 work', async () => {
    const plan = customCalibrationPlan('calibration-head-only', '首', 10, 20);
    const actual = customCalibrationActual('actual-head-only', plan.id, '首', 10, 20);
    const h = harness([{ ...emptyDelta(), add: customUnitFacts('項目', 10) }], {
      calendar: { plans: [plan], actuals: [actual] },
    });
    const result = await h.turn('custom-items', '10項目を暗記する');

    expect(result).toMatchObject({ outcome: 'applied', readiness: 'needs_resolution',
      question: { code: 'missing_effort_estimate' }, preview: null });
  });

  it('uses only custom 首 observations when 首 and 項目 calibrations are both present', async () => {
    const headPlan = customCalibrationPlan('calibration-head-mixed', '首', 10, 20);
    const itemPlan = customCalibrationPlan('calibration-item-mixed', '項目', 10, 40);
    const plans = [headPlan, itemPlan];
    const actuals = [
      customCalibrationActual('actual-head-mixed', headPlan.id, '首', 10, 20),
      customCalibrationActual('actual-item-mixed', itemPlan.id, '項目', 10, 40),
    ];
    const h = harness([{ ...emptyDelta(), add: customUnitFacts('首', 10) }], { calendar: { plans, actuals } });
    const result = await h.turn('mixed-custom-units', '10首を暗記する');
    // Hand-filter the V5 oracle to the calibration plan that has the same custom unit identity.
    const expectedPace = deriveWeeklyPlanningMemoryPaceEstimateV5({ plans: [headPlan], actuals, unitCode: 'custom' });

    expect(expectedPace.medianMinutesPerUnit).toBeCloseTo(2);
    expect(result).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(result.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(10 * expectedPace.medianMinutesPerUnit!);
  });

  it('recomputes after a quantity correction from observed pace without storing a derived estimate', async () => {
    const h = harness([memoryDelta(), (input) => ({ ...emptyDelta(), patch: [{ kind: 'workload', localId: 'quantity-correction',
      targetFactId: input.state.graph.workloads[0].id, amountDelta: null,
      changes: { amount: 70, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null,
        perOccurrence: null, periodExpression: null },
    }] })], { calendar: { plans: [calibrationPlan()], actuals: [calibrationActual()] } });
    const first = await h.turn('initial-work', '英単語35語を覚える');
    expect(first.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(first.preview!.blocks)).toBeCloseTo(20);
    const corrected = await h.turn('correct-quantity', '量を70語に訂正');

    expect(corrected).toMatchObject({ outcome: 'applied', readiness: 'ready', question: null });
    expect(corrected.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(corrected.preview!.blocks)).toBeCloseTo(40);
    const read = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(read.status).toBe('ready');
    if (read.status === 'ready') {
      const activeIds = new Set(read.checkpoint.state.graph.factLifecycles
        .filter(entry => entry.status === 'active').map(entry => entry.factId));
      expect(read.checkpoint.state.graph.workloads.filter(workload => activeIds.has(workload.id)).map(workload => workload.amount))
        .toEqual([70]);
      expect(read.checkpoint.state.graph.effortEstimates).toEqual([]);
    }
  });

  it('migrates a V5 study context as unknown and still asks despite valid calibration history', async () => {
    const conversationId = `${scope.conversationId}:legacy-memory`;
    const legacyV5 = legacyV5CheckpointWithMemoryContext(conversationId);
    const h = harness([emptyDelta()], {
      conversationId, legacyV5, calendar: { plans: [calibrationPlan()], actuals: [calibrationActual()] },
    });
    const migrated = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(migrated).toMatchObject({ source: 'migrated_v5', status: 'ready' });
    if (migrated.status !== 'ready') throw new Error('V5 memory context did not migrate');
    expect(migrated.checkpoint.state.graph.studyContexts[0].activityKind).toBe('unknown');

    const result = await h.turn('resume-legacy', '続けます');
    expect(result).toMatchObject({ outcome: 'noop', readiness: 'needs_resolution',
      question: { code: 'missing_effort_estimate' }, preview: null });
    const after = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(after.status).toBe('ready');
    if (after.status === 'ready') expect(after.checkpoint.state.graph.effortEstimates).toEqual([]);
  });

  it('reads a V1 checkpoint with an omitted activity as unknown but rejects an invalid activity value', async () => {
    const calendar = { plans: [calibrationPlan()], actuals: [calibrationActual()] };
    const missing = harness([memoryDelta(), emptyDelta()], { calendar });
    expect((await missing.turn('initial', '英単語35語を覚える')).readiness).toBe('ready');
    const oldEnvelope = JSON.parse(missing.storage.get('vnext')!) as {
      vnext: { state: { graph: { studyContexts: Array<Record<string, unknown>> } } };
    };
    delete oldEnvelope.vnext.state.graph.studyContexts[0].activityKind;
    missing.storage.set('vnext', JSON.stringify(oldEnvelope));

    const oldRead = readWeeklyPlanningVNextExperimentalSession(missing.scope, missing.ports);
    expect(oldRead).toMatchObject({ status: 'ready', source: 'vnext' });
    if (oldRead.status !== 'ready') throw new Error('V1 checkpoint with absent activity was not migrated');
    expect(oldRead.checkpoint.state.graph.studyContexts[0].activityKind).toBe('unknown');
    const resumed = await missing.turn('legacy-resume', '続けます');
    expect(resumed).toMatchObject({ outcome: 'noop', readiness: 'needs_resolution',
      question: { code: 'missing_effort_estimate' }, preview: null });

    const invalid = harness([memoryDelta()], { calendar });
    expect((await invalid.turn('initial', '英単語35語を覚える')).readiness).toBe('ready');
    const invalidEnvelope = JSON.parse(invalid.storage.get('vnext')!) as {
      vnext: { state: { graph: { studyContexts: Array<Record<string, unknown>> } } };
    };
    invalidEnvelope.vnext.state.graph.studyContexts[0].activityKind = 'bogus';
    invalid.storage.set('vnext', JSON.stringify(invalidEnvelope));
    expect(readWeeklyPlanningVNextExperimentalSession(invalid.scope, invalid.ports)).toEqual({ status: 'unreadable' });
  });

  it.each([true, false])('recovery reports whether a calibration-backed preview is retained when evidence changes=%s', async (removeCalibrationActual) => {
    const calendar: Calendar = { plans: [calibrationPlan()], actuals: [calibrationActual()] };
    const h = harness([memoryDelta()], { calendar });
    const shown = await h.turn('calibration-preview', '英単語35語を覚える');
    expect(shown.preview).not.toBeNull();

    if (removeCalibrationActual) calendar.actuals = [];
    h.ports.interpret = async () => ({ status: 'failed', reason: 'provider_error', errors: [],
      metrics: { calls: 1, repairs: 0, latencyMs: 1 } });
    const recoveryInputs: Array<{ recovery?: { retainedPreviewUnchanged: boolean } }> = [];
    h.ports.createRenderer = () => ({ async render(input) {
      recoveryInputs.push(input);
      return { status: 'rendered', text: '変更できませんでした。', rawResponse: '', recoveryVerified: true };
    } });

    const failed = await h.turn('provider-failure', '訂正します');
    const retainedPreviewUnchanged = recoveryInputs[0]?.recovery?.retainedPreviewUnchanged;
    const saved = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(saved.status).toBe('ready');
    if (saved.status !== 'ready') throw new Error('Recovery checkpoint did not reload');

    if (removeCalibrationActual) {
      expect(retainedPreviewUnchanged).toBe(false);
      expect(failed.preview).toBeNull();
      expect(saved.checkpoint.preview).toBeNull();
    } else {
      expect(retainedPreviewUnchanged).toBe(true);
      expect(failed.preview).toEqual(shown.preview);
      expect(saved.checkpoint.preview).toEqual(shown.preview);
    }
  });

  it.each(['answer', 'explicit_delta'] as const)('applies a unit correction and per-unit estimate from the same final basis via %s', async (form) => {
    const h = harness([memoryDelta('unknown')]);
    const first = await h.turn('asked-estimate', '35語を勉強する');
    expect(first.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 35, unitCode: 'word' } });

    h.ports.interpret = async (input) => {
      const workload = input.state.graph.workloads[0];
      const delta: VNextTurnDelta = { ...emptyDelta(), patch: [{ kind: 'workload', localId: 'correct-unit',
        targetFactId: workload.id, amountDelta: null, changes: { amount: null, unitCode: 'problem', unitLabel: '問',
          quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] };
      if (form === 'explicit_delta') delta.add.push({ kind: 'effort_estimate', localId: 'corrected-estimate',
        taskRef: { factId: workload.taskId }, targetRef: { factId: workload.id }, effortKind: 'duration_per_unit',
        minutes: 2, unitCode: 'problem', unitLabel: '問', precision: 'exact' });
      return { status: 'interpreted', delta,
        answer: form === 'answer' ? { kind: 'estimate_minutes', minutes: 2, per: 'unit' } : null,
        metrics: { calls: 1, repairs: 0, latencyMs: 1 } };
    };
    const result = await h.turn('correct-and-answer', '語ではなく35問です。1問あたり2分です。');
    expect(result.outcome).toBe('applied');
    expect(result.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(70);
    const read = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(read.status).toBe('ready');
    if (read.status === 'ready') {
      const activeFactIds = new Set(read.checkpoint.state.graph.factLifecycles
        .filter((entry) => entry.status === 'active').map((entry) => entry.factId));
      expect(read.checkpoint.state.graph.workloads.find((workload) => activeFactIds.has(workload.id)
        && workload.quantityRole === 'target'))
        .toMatchObject({ amount: 35, unitCode: 'problem', unitLabel: '問' });
      expect(read.checkpoint.state.graph.effortEstimates).toHaveLength(1);
    }
  });

  it('keeps a per-unit answer in the asked unit when the user does not correct that unit', async () => {
    const h = harness([memoryDelta('unknown')]);
    const asked = await h.turn('asked-estimate', '35語を勉強する');
    expect(asked.question).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 35, unitCode: 'word' } });

    h.ports.interpret = async () => ({ status: 'interpreted', delta: emptyDelta(),
      answer: { kind: 'estimate_minutes', minutes: 2, per: 'unit' }, metrics: { calls: 1, repairs: 0, latencyMs: 1 } });
    const result = await h.turn('answer-only', '1語あたり2分です');
    expect(result.outcome).toBe('applied');
    expect(result.preview).not.toBeNull();
    expect(estimatedPreviewMinutes(result.preview!.blocks)).toBeCloseTo(70);
    const read = readWeeklyPlanningVNextExperimentalSession(h.scope, h.ports);
    expect(read.status).toBe('ready');
    if (read.status === 'ready') {
      expect(read.checkpoint.state.graph.workloads[0]).toMatchObject({ amount: 35, unitCode: 'word', unitLabel: '語' });
      expect(read.checkpoint.state.graph.effortEstimates[0]).toMatchObject({ kind: 'duration_per_unit', unitCode: 'word' });
    }
  });
});
