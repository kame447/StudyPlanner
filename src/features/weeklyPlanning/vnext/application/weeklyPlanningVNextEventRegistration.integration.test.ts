import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanDraftBlock } from '../../types';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { projectWeeklyPlanningFixedEventRegistration } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { validateWeeklyPreviewApproval } from '../../planning/weeklyPlanningApproval';
import { fixedEventOnlyInteractionStatus, fixedEventCommunicationFacts } from '../../application/weeklyPlanningFixedEventOnlyInteraction';
import type { VNextEventRegistrationAct } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { approveWeeklyPlanningVNextExperimentalPreview, submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const OWNER = 'synthetic-registration-owner'; const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK,
  conversationId: 'registration-conversation', notBeforeTime: '09:00', clock: { currentDate: WEEK,
    weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } };
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const event = (id = 'club', category: 'study' | 'non_study' | 'unknown' = 'non_study', startTime = '16:00', endTime = '17:30'): VNextAddFact[] => [
  { kind: 'task', localId: id, category, title: id },
  { kind: 'temporal_constraint', localId: `${id}-time`, taskRef: { localId: id }, targetRef: { localId: id },
    constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
    startTime, endTime, precision: 'exact' },
];
const work: VNextAddFact[] = [{ kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'math-work', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'remaining',
    amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
const request = (targetRef: VNextEventRegistrationAct['targetRef'] = null): VNextEventRegistrationAct => ({ kind: 'request_event_registration', targetRef });
const wire = (add: VNextAddFact[] = [], conversationActs: VNextEventRegistrationAct[] = [], planningIntent: VNextPlanningIntent = 'discuss',
  delta: Partial<VNextTurnDelta> = {}) => ({ planningIntent, conversationActs, answer: null, delta: { ...EMPTY, add, ...delta } });
type Context = { activeFacts: { tasks: { id: string; title: string }[]; temporalConstraints: { id: string }[];
  workloads: { id: string }[] }; presentedQuestion: unknown };

function harness(responses: Array<unknown | ((context: Context) => unknown)>, failAt?: number) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const slots = new Map<string, string>();
  const saved = new Map<string, WeeklyPlanDraftBlock>();
  const rendererInputs: unknown[] = [];
  let calls = 0; let saves = 0; let sequence = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => slots.get('v5') ?? null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion(input) {
      calls++; if (!responses.length) throw new Error('synthetic script exhausted');
      const next = responses.shift(); return JSON.stringify(typeof next === 'function' ? next(JSON.parse(input.messages[1].content)) : next);
    } }, approvalLedger: { read: () => slots.get('ledger') ?? null, write: raw => { slots.set('ledger', raw); } },
    plans: { findExistingPlanId: async id => saved.has(id) ? `plan:${id}` : undefined,
      async saveBlock(block) { if (++saves === failAt) throw new Error('synthetic save failure'); saved.set(block.id, block); return { planId: `plan:${block.id}` }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => `${WEEK}T00:00:00.000Z`,
    createRenderer: () => ({ async render(input) { rendererInputs.push(input);
      return { status: 'rendered', text: '合成の候補説明', rawResponse: '' }; } }),
  };
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
    turnId: `turn-${++sequence}`, shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  const state = () => local.readCheckpoint()!.vnext.state;
  const oracle = (currentTurnId: string, targetPublicId: string | null = null, requested = true) => {
    const graph = state().graph;
    return projectWeeklyPlanningFixedEventRegistration({ graph, currentTurnId,
      compilation: compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
        context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } }),
      registrationActs: requested ? [{ kind: 'request_event_registration', targetPublicId }] : [] });
  };
  return { turn, local, memory, ports, slots, saved, state, oracle, rendererInputs, calls: () => calls, saves: () => saves };
}

describe('VNext native fixed-event registration through the unchanged V5 projection and approval', () => {
  it.each([
    { name: 'busy non-study', category: 'non_study' as const, requested: false, movable: false, expected: 'fixed_event_manual_entry' },
    { name: 'registration priority', category: 'non_study' as const, requested: true, movable: false, expected: 'fixed_event_registration_preview' },
    { name: 'movable work', category: 'non_study' as const, requested: false, movable: true, expected: undefined },
    { name: 'fixed study is not manual handoff', category: 'study' as const, requested: false, movable: false, expected: undefined },
    { name: 'captured unknown category remains V5 null', category: 'unknown' as const, requested: false, movable: false, expected: undefined },
  ])('V5 busy-only handoff same-input control: $name', async ({ category, requested, movable, expected }) => {
    const h = harness([wire([...event('club', category), ...(movable ? work : [])], requested ? [request()] : [])]);
    const result = await h.turn('11月3日16時から17時半までゼミがあります。'
      + (requested ? 'その予定を登録してください。' : '') + (movable ? '数学は60分です。' : ''));
    const graph = h.state().graph;
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
      context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } });
    const registrations = h.oracle('turn-1').candidates;
    const v5 = requested && registrations.length ? 'fixed_event_registration_preview' : fixedEventOnlyInteractionStatus({
      graph, compilation, semanticChanged: true, previousQuestionSlot: undefined, declinedAdditionalWork: false,
      requestedEventRegistration: requested, previousOptionalInvitationClosed: false });
    expect(v5 ?? undefined).toBe(expected);
    expect(h.rendererInputs[0]).toMatchObject({ communication: expected ? fixedEventCommunicationFacts(v5!) : {} });
    expect((h.rendererInputs[0] as { communication: { statusReason?: string } }).communication.statusReason).toBe(expected);
    expect(result.preview !== null).toBe(requested);
    expect(h.saved.size).toBe(0);
  });

  it('V5 busy-only handoff ends an unchanged fixed-only turn without another invitation', async () => {
    const h = harness([wire(event()), wire()]); await h.turn('11月3日16時から17時半までゼミがあります。');
    const result = await h.turn('わかりました');
    const graph = h.state().graph;
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
      context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } });
    const v5 = fixedEventOnlyInteractionStatus({ graph, compilation, semanticChanged: false, previousQuestionSlot: undefined,
      declinedAdditionalWork: false, requestedEventRegistration: false, previousOptionalInvitationClosed: false });
    expect(v5).toBe('no_additional_work');
    expect(h.rendererInputs[1]).toMatchObject({ communication: fixedEventCommunicationFacts(v5!) });
    expect(result.question).toBeNull(); expect(result.preview).toBeNull(); expect(h.saved.size).toBe(0);
  });

  it('keeps the V5 optional-decline path distinct from VNext task questions (no new invitation)', async () => {
    const h = harness([wire([{ kind: 'availability_declaration', localId: 'busy', availabilityKind: 'unavailable',
      dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: '17:30', recurrenceKind: null,
      days: [], capacityMinutes: null, constraintLevel: 'hard' }])]);
    const result = await h.turn('その間は勉強できません');
    expect(result.outcome).toBe('applied');
    const graph = h.state().graph;
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
      context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } });
    const input = { graph, compilation, semanticChanged: true, previousQuestionSlot: undefined,
      requestedEventRegistration: false, previousOptionalInvitationClosed: false };
    expect(fixedEventOnlyInteractionStatus({ ...input, declinedAdditionalWork: false })).toBeNull();
    // V5's supported declined optional invitation is a separate, currently unported path.
    expect(fixedEventOnlyInteractionStatus({ ...input, previousQuestionSlot: 'stable_v5:missing_schedulable_work',
      declinedAdditionalWork: true })).toBe('no_additional_work');
    expect(result.question).toBeNull(); expect(result.preview).toBeNull();
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion).toBeNull();
    expect(h.state().graph.availabilityDeclarations).toHaveLength(1); expect(h.saved.size).toBe(0);
  });

  it.each([false, true])('AB01 shows and saves newly authorized study after a registration preview (alreadySaved=%s)', async alreadySaved => {
    const h = harness([wire([...event(), ...work], [request({ localId: 'club' })]), wire([], [], 'create_plan'), wire([], [], 'create_plan')]);
    const first = await h.turn('部活を登録して。数学は60分です');
    expect(first.draftCandidates?.map(c => c.source)).toEqual(['fixed_event_registration']);
    if (alreadySaved) expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    const graph = structuredClone(h.state().graph);
    const next = await h.turn('数学の予定も作ってください');
    expect(next.authorizationDecision?.authorized).toBe(true);
    expect(next.draftCandidates?.filter(c => c.source === 'weekly_exam_prep')).toHaveLength(1);
    expect(next.preview?.blocks.some(block => block.title.includes('数学'))).toBe(true);
    expect(next.graphRevision).toBe(first.graphRevision! + 1);
    expect(h.state().graph).toEqual({ ...graph, revision: graph.revision + 1,
      appliedTurnKeys: [...graph.appliedTurnKeys, `${scope.conversationId}:turn-2`] });
    expect(validateWeeklyPreviewApproval({ blocks: first.preview!.blocks, currentStateRevision: h.state().graph.revision,
      userId: OWNER, proposalRecords: [], runtimeSnapshot: { conversationId: scope.conversationId,
        stateRevision: h.state().graph.revision, proposalRecords: [] } })).toMatchObject({ allowed: false, attempt: { kind: 'stale_preview_approval_attempt' } });
    expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(h.saves()).toBe(alreadySaved ? 2 : 1);
    expect([...h.saved.values()].filter(block => block.title.includes('数学'))).toHaveLength(1);
    expect([...h.saved.values()].filter(block => block.title === 'club')).toHaveLength(alreadySaved ? 1 : 0);
    const revision = h.state().graph.revision; const saves = h.saves();
    expect((await h.turn('同じ数学の予定を作って')).outcome).toBe('noop');
    expect(h.state().graph.revision).toBe(revision);
    await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports }); expect(h.saves()).toBe(saves);
  });

  it('AB01 does not advance for a permission grant with no new candidates', async () => {
    const h = harness([wire(event(), [request()]), wire([], [], 'create_plan')]);
    const first = await h.turn('部活を登録して'); const graph = structuredClone(h.state().graph);
    const next = await h.turn('この条件で予定を作って');
    expect(next.authorizationDecision?.authorized).toBe(true); expect(h.state().draftGenerationIntent).toBe('user_authorized');
    expect(next.outcome).toBe('noop'); expect(next.graphRevision).toBe(first.graphRevision);
    expect(h.state().graph).toEqual(graph); expect(next.preview).toEqual(first.preview); expect(next.draftCandidates).toEqual([]);
  });

  it.each(['study', 'non_study'] as const)('matches V5 at the stated interval without study authorization or estimate buffer (%s)', async category => {
    const h = harness([wire(event('club', category), [request()])]);
    const result = await h.turn('火曜16時から17時半の予定を登録してください');
    expect(result.outcome).toBe('applied'); expect(result.question).toBeNull();
    expect(result.draftCandidates).toEqual(h.oracle('turn-1').candidates);
    expect(result.draftCandidates).toEqual([expect.objectContaining({ source: 'fixed_event_registration', date: '2026-11-03',
      startTime: '16:00', endTime: '17:30', durationMinutes: 90, stableV5Metadata: expect.objectContaining({ planType: category === 'study' ? 'study' : 'other' }) })]);
    expect(result.draftCandidates![0]).not.toHaveProperty('estimatedMinutes');
    expect(h.state().graph.workloads).toEqual([]); expect(h.state().graph.effortEstimates).toEqual([]);
    expect(h.state().draftGenerationIntent).toBe('not_requested');
    expect(h.rendererInputs[0]).toMatchObject({ actionKind: 'preview_ready', communication: {
      statusReason: 'fixed_event_registration_preview', eventRegistration: { eventCreatedByTurn: false, candidates: result.draftCandidates } } });
  });

  it.each(['discuss', 'create_plan'] as const)('keeps a fixed time busy-only without a registration act (intent=%s)', async intent => {
    const h = harness([wire(event(), [], intent)]); const result = await h.turn('火曜16時から17時半は部活です');
    expect(result.draftCandidates).toEqual(h.oracle('turn-1', null, false).candidates);
    expect(result.preview).toBeNull(); expect(h.state().graph.temporalConstraints).toHaveLength(1);
  });

  it.each(['discuss', 'create_plan'] as const)('keeps event and movable-work rules separate on a mixed turn (%s)', async intent => {
    const h = harness([wire([...event(), ...work], [request({ localId: 'club' })], intent)]);
    const result = await h.turn('部活を登録して。数学は60分です');
    expect(result.draftCandidates?.filter(c => c.source === 'fixed_event_registration')).toEqual(h.oracle('turn-1', h.state().graph.tasks[0].id).candidates);
    expect(result.draftCandidates?.filter(c => c.source === 'weekly_exam_prep').length).toBe(intent === 'create_plan' ? 1 : 0);
    expect(result.authorizationRequired).toBe(intent !== 'create_plan');
    expect(h.state().draftGenerationIntent).toBe(intent === 'create_plan' ? 'user_authorized' : 'not_requested');
    if (intent === 'discuss') expect(h.rendererInputs[0]).toMatchObject({ communication: {
      eventRegistration: { workAwaitingAuthorization: ['数学 60分'] }, previewAuthorization: { status: 'authorization_required' } } });
  });

  it('selects only the new task named by its local reference', async () => {
    const h = harness([wire([...event('club'), ...event('seminar', 'non_study', '17:00', '21:00')], [request({ localId: 'seminar' })])]);
    const result = await h.turn('部活は16時から17時半。ゼミは17時から21時で、ゼミだけ登録して');
    expect(result.draftCandidates?.map(c => [c.title, c.startTime, c.endTime])).toEqual([['seminar', '17:00', '21:00']]);
  });

  it('uses an existing F alias for a later registration and does not let null select historical tasks', async () => {
    const h = harness([wire(event()), wire([], [request()]), (context: Context) => wire([], [request({ factId: context.activeFacts.tasks[0].id })])]);
    await h.turn('部活は火曜16時から17時半');
    expect((await h.turn('今回の予定を登録して')).preview).toBeNull();
    const result = await h.turn('その部活を登録して');
    expect(result.outcome).toBe('applied'); expect(result.draftCandidates).toEqual(h.oracle('turn-3', h.state().graph.tasks[0].id).candidates);
    expect(result.draftCandidates).toHaveLength(1);
  });

  it('keeps overlaps exactly as V5 projects them instead of moving or splitting an event', async () => {
    const h = harness([wire([...event('club'), ...event('seminar', 'non_study', '17:00', '21:00')], [request()])]);
    const result = await h.turn('両方の固定予定を登録して');
    expect(result.draftCandidates).toEqual(h.oracle('turn-1').candidates);
    expect(h.rendererInputs[0]).toMatchObject({ communication: { eventRegistration: { overlaps: [
      { date: '2026-11-03', startTime: '17:00', endTime: '17:30', titles: ['club', 'seminar'] },
    ] } } });
  });

  it('adds a later explicit registration to a study preview without changing accepted facts', async () => {
    const h = harness([wire([...event(), ...work], [], 'create_plan'),
      ...Array.from({ length: 3 }, () => (context: Context) => wire([], [request({ factId: context.activeFacts.tasks.find(task => task.title === 'club')!.id })]))]);
    const first = await h.turn('部活は火曜16時から17時半。数学60分で予定を作って');
    expect(first.draftCandidates?.map(c => c.source)).toEqual(['weekly_exam_prep']);
    expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    const graph = structuredClone(h.state().graph);
    const second = await h.turn('その部活も登録して');
    expect(h.state().graph).toEqual({ ...graph, revision: graph.revision + 1,
      appliedTurnKeys: [...graph.appliedTurnKeys, `${scope.conversationId}:turn-2`] });
    // V5's draft-ready discuss gate keeps study work unplaced; the registration is independent.
    expect(second.draftCandidates?.map(c => c.source)).toEqual(['fixed_event_registration']);
    expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(h.saved.size).toBe(2);
    expect(validateWeeklyPreviewApproval({ blocks: first.preview!.blocks, currentStateRevision: h.state().graph.revision,
      userId: OWNER, proposalRecords: [], runtimeSnapshot: { conversationId: scope.conversationId,
        stateRevision: h.state().graph.revision, proposalRecords: [] } })).toMatchObject({ allowed: false,
      attempt: { kind: 'stale_preview_approval_attempt' } });
    const revision = h.state().graph.revision; const saves = h.saves();
    expect((await h.turn('同じ部活を登録して')).outcome).toBe('noop');
    expect(h.state().graph.revision).toBe(revision);
    await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports }); expect(h.saves()).toBe(saves);
    const graphAfterNoop = structuredClone(h.state().graph);
    expect((await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: h.ports, turnId: 'turn-3',
      userText: '同じ部活を登録して', shownRevision: null })).outcome).toBe('duplicate');
    expect(h.state().graph).toEqual(graphAfterNoop); expect(h.saved.size).toBe(2);
  });

  it('rejects a bad registration inside the sole transaction without changing state or its revision', () => {
    const state = createEmptyWeeklyPlanningVNextState();
    const result = applyWeeklyPlanningVNextTurn(state, { ...EMPTY, add: event() }, {
      conversationId: scope.conversationId, turnId: 'bad', turnKey: 'bad', sourceText: '指定した予定だけ登録して',
      expectedRevision: 0, acceptedDate: WEEK, weekStartsOn: 'monday',
      planningHorizon: { startDate: WEEK, endDate: '2026-11-08' }, defaultPlanningHorizon: { startDate: WEEK, endDate: '2026-11-08' },
      preview: { shownPreviewBlockIds: [], authorizedCandidateKeys: [], eventRegistration: { acts: [request({ localId: 'unknown' })], compilation: null } },
    });
    expect(result).toMatchObject({ status: 'rejected', errors: [{ code: 'unknown_ref', path: 'conversationActs[0].targetRef' }] });
    expect(result.state).toBe(state); expect(state.graph.revision).toBe(0); expect(state.graph.tasks).toEqual([]);
  });

  it('does not bind an old shown question after registration advances the revision; re-presents the current question', async () => {
    const pages = { ...work[1], amount: 8, unitCode: 'page', unitLabel: '枚' } as VNextAddFact;
    const answer = { kind: 'estimate_minutes', optionId: null, minutes: 60, per: 'whole_work' };
    const h = harness([wire([...event(), work[0], pages], [], 'create_plan'), { ...wire(), answer },
      (context: Context) => wire([], [request({ factId: context.activeFacts.tasks.find(task => task.title === 'club')!.id })]),
      (context: Context) => wire([], [], 'update_plan', { patch: [{ kind: 'workload', localId: 'quantity-correction',
        targetFactId: context.activeFacts.workloads[0].id, amountDelta: null, changes: { amount: 6, quantityRole: null,
          unitCode: null, unitLabel: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] }),
      (context: Context) => { expect(context.presentedQuestion).toBeNull(); return { ...wire(), answer: { ...answer, minutes: 120 } }; },
    ]);
    const first = await h.turn('数学は8枚で予定を作って。部活は火曜16時から17時半');
    expect(first.question?.code).toBe('missing_effort_estimate');
    const study = await h.turn('その作業は全部で60分'); expect(study.preview).not.toBeNull();
    const registered = await h.turn('その部活も登録して'); expect(registered.graphRevision).toBe(study.graphRevision! + 1);
    const corrected = await h.turn('数学は6枚に訂正して'); expect(corrected.question?.code).toBe('missing_effort_estimate');
    const before = structuredClone(h.state().graph);
    const stale = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: h.ports, turnId: 'stale-answer',
      userText: '全部で120分です', shownRevision: first.graphRevision });
    expect(stale.outcome).toBe('answer_represented'); expect(h.state().graph).toEqual(before);
    expect(stale.question?.key).toBe(corrected.question?.key);
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion).toMatchObject({ questionKey: corrected.question!.key,
      graphRevision: corrected.graphRevision, shownText: stale.reply });
  });

  it('uses V5 manual guidance for multiple intervals, without inventing movable work', async () => {
    const facts = event(); const second = { ...facts[1], localId: 'second-time', startTime: '19:00', endTime: '20:00' } as VNextAddFact;
    const h = harness([wire([...facts, second], [request()])]); const result = await h.turn('部活の二つの時間を登録して');
    expect(result.draftCandidates).toEqual([]); expect(result.preview).toBeNull();
    expect(h.oracle('turn-1').unregistered).toEqual([expect.objectContaining({ reason: 'multiple_intervals' })]);
    expect(h.rendererInputs[0]).toMatchObject({ communication: { statusReason: 'fixed_event_manual_entry',
      eventRegistration: { eventCreatedByTurn: false, unregistered: [expect.objectContaining({ reason: 'multiple_intervals' })] } } });
  });

  it('repairs an unknown selective target once, retaining both independent tasks', async () => {
    const facts = [...event('club'), ...event('seminar')];
    const h = harness([wire(facts, [request({ localId: 'missing' })]), wire(facts, [request({ localId: 'seminar' })])]);
    const result = await h.turn('二つのうちゼミだけ登録して');
    expect(result.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    expect(h.state().graph.tasks).toHaveLength(2); expect(result.draftCandidates?.map(c => c.title)).toEqual(['seminar']);
  });

  it.each(['missing', 'wrong_kind'] as const)('rejects an invalid act atomically instead of widening it (%s)', async kind => {
    const facts = [...event(), ...work]; const reading = wire(facts, [request({ localId: kind === 'missing' ? 'missing' : 'math-work' })]);
    const h = harness([reading, reading]); const result = await h.turn('指定した予定だけ登録して');
    expect(result.outcome).toBe('interpretation_failed'); expect(h.calls()).toBe(2);
    expect(result.preview).toBeNull(); expect(h.state().graph.tasks).toEqual([]);
  });

  it('reloads exactly the shown registration and resumes the existing approval ledger without duplicate saves', async () => {
    const h = harness([wire(event(), [request()])], 1); const result = await h.turn('部活を登録して');
    const raw = h.local.checkpoint.read(); h.slots.set('v5', 'untouched-v5-checkpoint');
    const reloaded = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: h.memory.storage });
    expect(reloaded.readCheckpoint()!.vnext.preview).toEqual(result.preview);
    const ports = { ...h.ports, checkpoint: reloaded.checkpoint };
    const first = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
    expect(first).toMatchObject({ status: 'executed', operation: { status: 'failed' } });
    expect(h.slots.get('ledger')).toBeTruthy();
    const resumed = await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
    expect(resumed).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(h.saved.size).toBe(1); expect([...h.saved.values()][0]).toMatchObject({ date: '2026-11-03', startTime: '16:00', endTime: '17:30', type: 'other' });
    const saves = h.saves(); await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports });
    expect(h.saves()).toBe(saves); expect(h.local.checkpoint.read()).toBe(raw); expect(h.slots.get('v5')).toBe('untouched-v5-checkpoint');
  });
});
