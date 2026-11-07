import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanDraftBlock } from '../../types';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { stableV5MissingSchedulableWorkQuestion, projectWeeklyPlanningFixedEventRegistration } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { buildWeeklyPlanningPlanSourceId } from '../../planning/weeklyPlanningPlanProvenance';
import { validateWeeklyPreviewApproval } from '../../planning/weeklyPlanningApproval';
import { fixedEventOnlyInteractionStatus, fixedEventCommunicationFacts } from '../../application/weeklyPlanningFixedEventOnlyInteraction';
import type { VNextEventRegistrationAct } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { presentWeeklyPlanningVNextQuestion } from './weeklyPlanningVNextQuestionText';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { approveWeeklyPlanningVNextExperimentalPreview } from './weeklyPlanningVNextExperimentalApproval';

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

function harness(responses: Array<unknown | ((context: Context) => unknown)>, failAt?: number, options: { savedAsPlans?: boolean } = {}) {
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
    // With savedAsPlans the calendar holds the plans approval saved, each carrying the draft block id it came from.
    calendar: () => ({ plans: options.savedAsPlans ? [...saved.values()].map(block => ({ id: `plan:${block.id}`, seriesId: `plan:${block.id}`,
      userId: OWNER, title: block.title, subject: block.subject, type: 'study' as const, date: block.date, startTime: block.startTime, endTime: block.endTime,
      memo: '', recurrence: null, recurrenceRules: [], excludedDates: [], createdAt: block.createdAt, updatedAt: block.updatedAt, sourceType: 'weekly-planning' as const,
      sourceId: buildWeeklyPlanningPlanSourceId({ approvalOperationId: 'op-1', sourceDraftBlockId: block.id }) })) as never : [],
      actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => `${WEEK}T00:00:00.000Z`,
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
  it('retains one requested event through unknown answers, reload and another question, then consumes only its captured preview', async () => {
    const conference: VNextAddFact[] = [
      { kind: 'task', localId: 'conference', title: 'カンファレンス', category: 'non_study' },
      { kind: 'task_date_rule', localId: 'conference-date', taskRef: { localId: 'conference' }, targetRef: { localId: 'conference' },
        ruleKind: 'allowed_date', dateExpression: '2026-11-03', constraintLevel: 'hard' },
    ];
    const h = harness([
      wire([...conference, { kind: 'task', localId: 'math', title: '数学', category: 'study' }], [request({ localId: 'conference' })]),
      wire(),
      (context: Context) => { const id = context.activeFacts.tasks.find(task => task.title === 'カンファレンス')!.id;
        return wire([{ kind: 'temporal_constraint', localId: 'conference-time', taskRef: { factId: id }, targetRef: { factId: id },
          constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
          startTime: '14:00', endTime: '15:00', precision: 'exact' }]); },
      (context: Context) => { const id = context.activeFacts.tasks.find(task => task.title === '数学')!.id;
        return wire([{ ...work.find(fact => fact.kind === 'workload')!, taskRef: { factId: id } }]); },
      wire(event('later-busy')),
    ]);
    const first = await h.turn('明日のカンファレンスを登録して。数学もやりたいです');
    const targetId = h.state().graph.tasks.find(task => task.title === 'カンファレンス')!.id;
    expect(first.question).toMatchObject({ code: 'invalid_commitment_interval', taskId: targetId });
    expect(h.state().pendingEventRegistrationTargetIds).toEqual([targetId]);
    const unknown = await h.turn('まだ時刻は分かりません');
    expect(unknown.question?.key).toBe(first.question!.key);
    const reloaded = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: h.memory.storage });
    expect(reloaded.readCheckpoint()!.vnext.state.pendingEventRegistrationTargetIds).toEqual([targetId]);
    expect(reloaded.readCheckpoint()!.vnext.preview).toBeNull();
    const timed = await h.turn('カンファレンスは14時から15時です');
    expect(timed.question).toMatchObject({ code: 'missing_schedulable_work', taskId: h.state().graph.tasks.find(task => task.title === '数学')!.id });
    expect(timed.preview).toBeNull();
    expect(h.state().pendingEventRegistrationTargetIds).toEqual([targetId]);
    expect(h.saves()).toBe(0);
    const ready = await h.turn('数学は60分やります');
    expect(ready.draftCandidates?.map(candidate => [candidate.title, candidate.date, candidate.startTime, candidate.endTime]))
      .toEqual([['カンファレンス', '2026-11-03', '14:00', '15:00']]);
    expect(h.state()).not.toHaveProperty('pendingEventRegistrationTargetIds');
    expect(h.state().draftGenerationIntent).toBe('not_requested');
    expect(h.saves()).toBe(0);
    expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    expect(h.saves()).toBe(1);
    const later = await h.turn('別の固定予定も分かりました');
    expect(later.preview).toBeNull();
    expect(later.draftCandidates?.filter(candidate => candidate.source === 'fixed_event_registration') ?? []).toEqual([]);
    await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports });
    expect(h.saves()).toBe(1);
  });

  it.each([true, false])('keeps null registration limited to tasks stated in its own turn (sameTurn=%s)', async sameTurn => {
    const task: VNextAddFact = { kind: 'task', localId: 'conference', title: 'カンファレンス', category: 'non_study' };
    const h = harness(sameTurn ? [wire([task], [request()])] : [wire([task]), wire([], [request()])]);
    let result = await h.turn('カンファレンスがあります');
    if (!sameTurn) result = await h.turn('今回の予定を登録して');
    expect(result.question?.code).toBe(sameTurn ? 'invalid_commitment_interval' : 'missing_schedulable_work');
    expect(h.state().pendingEventRegistrationTargetIds ?? []).toEqual(sameTurn ? [h.state().graph.tasks[0].id] : []);
    expect(result.preview).toBeNull(); expect(h.saves()).toBe(0);
  });

  it.each([false, true])('asks for fixed clock bounds only when the timeless task is requested as a registration (requested=%s)', async requested => {
    const task: VNextAddFact = { kind: 'task', localId: 'conference', title: 'カンファレンス', category: 'non_study' };
    const date: VNextAddFact = { kind: 'task_date_rule', localId: 'conference-date',
      taskRef: { localId: 'conference' }, targetRef: { localId: 'conference' }, ruleKind: 'allowed_date',
      dateExpression: '2026-11-03', constraintLevel: 'hard' };
    const h = harness([wire([task, date], requested ? [request({ localId: 'conference' })] : [])]);
    const result = await h.turn(`明日カンファレンスがあります。${requested ? '予定に入れてください。' : ''}`);
    expect(result.outcome).toBe('applied');
    expect(h.state().graph.tasks).toHaveLength(1);
    expect(result.preview).toBeNull();
    expect(h.saves()).toBe(0);
    expect(h.rendererInputs[0]).toMatchObject({ questionIntent: requested
      ? { kind: 'resolution_question', resolutionKind: 'commitment_time_bounds', requestedInformation: ['commitment_start_and_end_time'] }
      : { kind: 'schedulable_work_detail', mode: 'open_ended_session', requestedInformation: ['session_allocation'] } });
  });

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

  it('presents the V5 optional invitation for unavailable-only information, distinct from required task questions', async () => {
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
    // V5 owns optional closure; the native invitation now presents that same slot.
    expect(fixedEventOnlyInteractionStatus({ ...input, previousQuestionSlot: 'stable_v5:missing_schedulable_work',
      declinedAdditionalWork: true })).toBe('no_additional_work');
    expect(result.question).toMatchObject({ code: 'missing_schedulable_work', taskId: null, optionalInvitation: { intent: 'missing_task_identity' } });
    expect(result.preview).toBeNull();
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion?.questionKey).toBe(result.question!.key);
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

  // Real-API run 41329745801: a study preview was shown (unapproved), then a registration turn was read as
  // planningIntent 'unknown'. V5's shared gate (draft_ready needs update_plan with a semantic change) does not
  // re-authorize study work, so the preview held only the registration and said the study work is not placed.
  it('keeps an unapproved study preview out of a later registration turn exactly as V5 does, and returns it on the V5 permissions', async () => {
    const registerClub = (intent: VNextPlanningIntent, add: VNextAddFact[] = []) => (context: Context) => wire(add, [request(
      add.length ? null : { factId: context.activeFacts.tasks.find(task => task.title === 'club')!.id })], intent);
    const h = harness([wire([...event(), ...work], [], 'create_plan'), registerClub('unknown')]);
    const first = await h.turn('部活は火曜16時から17時半。数学60分で予定を作って');
    expect(first.draftCandidates?.map(c => c.source)).toEqual(['weekly_exam_prep']);
    const second = await h.turn('その部活も登録して');
    expect(second.draftCandidates?.map(c => c.source)).toEqual(['fixed_event_registration']);
    expect(second.authorizationRequired).toBe(true);
    // The reply discloses the unplaced study work by its label, as V5's registration communication does.
    expect(JSON.stringify((h.rendererInputs[1] as { communication: unknown }).communication)).toContain('数学');

    // The same turn, read as update_plan with a semantic change (V5's permission), keeps both.
    const permitted = harness([wire([...event(), ...work], [], 'create_plan'), registerClub('update_plan', event('seminar', 'non_study', '19:00', '20:00'))]);
    await permitted.turn('部活は火曜16時から17時半。数学60分で予定を作って');
    const both = await permitted.turn('ゼミも登録して。予定を更新して');
    expect(both.draftCandidates?.map(c => c.source).sort()).toEqual(['fixed_event_registration', 'weekly_exam_prep']);
    expect(both.authorizationRequired).toBe(false);
  });

  // D1 (Japanese review, run 41336864039): after the study plan was approved and saved, the registration reply said
  // the study work "is not placed yet". The same fact, by identity, in the same turn with and without the save:
  it.each([
    { saved: true, expected: undefined },
    { saved: false, expected: ['数学 60分'] },
  ])('reports study work as awaiting authorization only when no saved plan covers it (saved=$saved)', async ({ saved, expected }) => {
    const h = harness([wire(work, [], 'create_plan'),
      wire(event('club'), [request(null)], 'unknown')], undefined, { savedAsPlans: true });
    const first = await h.turn('数学は60分。予定を作って');
    expect(first.draftCandidates?.map(c => c.source)).toEqual(['weekly_exam_prep']);
    if (saved) expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
    const second = await h.turn('11月3日16時から17時半までクラブです。登録して');
    expect(second.draftCandidates?.map(c => c.source)).toEqual(['fixed_event_registration']);
    const facts = (h.rendererInputs[1] as { communication: { eventRegistration?: { workAwaitingAuthorization?: string[] } } }).communication;
    expect(facts.eventRegistration?.workAwaitingAuthorization).toEqual(expected);
    // The permission and the stored state are untouched either way; only the claim and the scope request differ.
    expect(second.authorizationRequired).toBe(!saved);
    expect(h.state().draftGenerationIntent).toBe('user_authorized');
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
  const decline: VNextEventRegistrationAct = { kind: 'decline_additional_work', targetRef: null };
  const busy = (id = 'busy'): VNextAddFact => ({ kind: 'availability_declaration', localId: id,
    availabilityKind: 'unavailable', dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: '17:30',
    recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' });

  it.each(['empty', 'unavailable'] as const)('V5 optional parity: %s invites, declines, stays closed after reload, and new work reopens', async mode => {
    const h = harness([wire(mode === 'empty' ? [] : [busy()], [], 'create_plan'), wire(), wire([], [decline]), wire(), wire(work, [], 'create_plan')]);
    const first = await h.turn(mode === 'empty' ? '今週の学習計画を作ってください。' : '11月3日16時から17時半は勉強できません。');
    expect(first.question).toMatchObject({ code: 'missing_schedulable_work', taskId: null, optionalInvitation: { intent: 'missing_task_identity' } });
    const v5Question = stableV5MissingSchedulableWorkQuestion(h.state().graph);
    expect(presentWeeklyPlanningVNextQuestion(h.state(), first.question!).text).toBe(v5Question.message);
    expect(h.rendererInputs[0]).toMatchObject({ actionKind: 'question', questionCode: v5Question.questionCode,
      questionTarget: null, questionIntent: { kind: 'schedulable_work_detail', mode: 'missing_task_identity' },
      communication: { askQuestion: true } });
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion?.questionKey).toBe(first.question!.key);
    expect(h.state().optionalInvitationClosed).toBe(false);
    const repeat = await h.turn('わかりました');
    expect(repeat.question?.key).toBe(first.question!.key);
    const closed = await h.turn('特にないです');
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(h.state().graph),
      context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } });
    expect(fixedEventOnlyInteractionStatus({ graph: h.state().graph, compilation, semanticChanged: false,
      previousQuestionSlot: 'stable_v5:missing_schedulable_work', declinedAdditionalWork: true,
      requestedEventRegistration: false, previousOptionalInvitationClosed: false })).toBe('no_additional_work');
    expect(closed.question).toBeNull(); expect(closed.preview).toBeNull();
    expect(h.rendererInputs[2]).toMatchObject({ communication: { askQuestion: false, statusReason: 'no_additional_work' } });
    expect(h.state().optionalInvitationClosed).toBe(true);
    expect(h.local.readCheckpoint()!.vnext.presentedQuestion).toBeNull();
    // Every turn reloads through the real codec, so the next call reads the persisted closed state.
    const unchanged = await h.turn('変わりません');
    expect(unchanged.question).toBeNull(); expect(h.state().optionalInvitationClosed).toBe(true);
    expect(h.rendererInputs[3]).toMatchObject({ communication: { statusReason: 'no_additional_work', askQuestion: false } });
    expect(h.state().graph.availabilityDeclarations).toHaveLength(mode === 'empty' ? 0 : 1);
    const reopened = await h.turn('数学を60分、予定にしてください');
    expect(h.state().optionalInvitationClosed).toBe(false);
    expect(reopened.preview).not.toBeNull(); expect(reopened.draftCandidates).toHaveLength(1);
    expect(reopened.authorizationDecision?.authorized).toBe(true);
    expect(h.saves()).toBe(0);
    expect(h.calls()).toBe(5); // One native reading each; invitation/decline adds no provider call.
  });

  it('reopens V5 optional invitation when new unavailable facts arrive after a decline', async () => {
    const h = harness([wire(), wire([], [decline]), wire([busy()])]);
    await h.turn('今週の相談です'); await h.turn('特にないです');
    expect(h.state().optionalInvitationClosed).toBe(true);
    const next = await h.turn('11月3日の16時から17時半は勉強できません');
    expect(next.question?.optionalInvitation).toBeDefined();expect(h.state().optionalInvitationClosed).toBe(false);
    expect(h.saves()).toBe(0);
  });

  it('does not let a decline dismiss a required task quantity question with the same question code', async () => {
    const h = harness([wire([{ kind: 'task', localId: 'math', title: '数学', category: 'study' }]), wire([], [decline])]);
    const first = await h.turn('数学をやります');
    expect(first.question).toMatchObject({ code: 'missing_schedulable_work', taskId: expect.any(String) });
    expect(first.question?.optionalInvitation).toBeUndefined();
    const next = await h.turn('特にないです');
    expect(next.question?.key).toBe(first.question?.key);
    expect(h.state().optionalInvitationClosed).toBe(false);expect(next.preview).toBeNull();expect(h.saves()).toBe(0);
    expect(h.rendererInputs[1]).toMatchObject({ communication: { askQuestion: true } });
    expect((h.rendererInputs[1] as { communication: { statusReason?: string } }).communication.statusReason).toBeUndefined();
  });

  it('keeps a required estimate ahead of an unrelated decline and preserves movable work', async () => {
    const pages: VNextAddFact[] = [work[0], { ...work[1], localId: 'pages', unitCode: 'page', unitLabel: 'ページ', amount: 10 } as VNextAddFact];
    const h = harness([wire(pages), wire([], [decline])]); const first = await h.turn('数学は残り10ページです');
    expect(first.question?.code).toBe('missing_effort_estimate');
    const next = await h.turn('追加はないです');expect(next.question?.key).toBe(first.question?.key);
    expect(h.state().optionalInvitationClosed).toBe(false);expect(h.state().graph.workloads).toHaveLength(1);expect(h.saves()).toBe(0);
  });

  it('keeps registration priority when decline and registration are stated together after an invitation', async () => {
    const h = harness([wire(), wire(event(), [decline, request({ localId: 'club' })])]);
    await h.turn('今週の相談です');const next = await h.turn('ほかの作業はありません。部活はその時間で登録してください');
    expect(next.question).toBeNull();expect(next.draftCandidates).toHaveLength(1);expect(next.preview).not.toBeNull();
    expect(h.rendererInputs[1]).toMatchObject({ communication: { statusReason: 'fixed_event_registration_preview' } });
    expect(h.state().optionalInvitationClosed).toBe(false);expect(h.state().draftGenerationIntent).toBe('not_requested');expect(h.saves()).toBe(0);
  });

  it('matches V5 fixed-task handoff, immediate decline, repeat and targeted acknowledgment registration', async () => {
    const h = harness([wire(event()), wire([], [decline]), wire(), (context: Context) => wire([], [request({ factId: context.activeFacts.tasks[0].id })], 'unknown')]);
    const first = await h.turn('11月3日16時から17時半までゼミがあります。');
    expect(first.question).toBeNull();expect(h.rendererInputs[0]).toMatchObject({ communication: { statusReason: 'fixed_event_manual_entry' } });
    await h.turn('特にないです');await h.turn('変わりません');
    for (const input of h.rendererInputs.slice(1)) expect(input).toMatchObject({ communication: { askQuestion: false, statusReason: 'no_additional_work' } });
    const last = await h.turn('うん、お願い。');expect(last.draftCandidates).toHaveLength(1);expect(h.saves()).toBe(0);
  });

  it('does not close the empty invitation from a stale presented reply', async () => {
    const h = harness([wire(), wire([], [decline])]);await h.turn('今週の相談です');
    const next = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports: h.ports, turnId: 'stale-decline', userText: '特にないです', shownRevision: -1 });
    expect(next.question?.optionalInvitation).toBeDefined();expect(h.state().optionalInvitationClosed).toBe(false);expect(h.saves()).toBe(0);
  });

  it.each(['unsupported wire', 'rejected transaction'] as const)('persists no decline state for %s', async mode => {
    const unsupported = { ...wire(), conversationActs: [{ kind: 'topic_shift', targetRef: null }] };
    const h = harness([wire(), unsupported, unsupported]);await h.turn('今週の相談です');const before = structuredClone(h.state());
    if (mode === 'rejected transaction') h.ports.interpret = async () => ({ status: 'interpreted', planningIntent: 'discuss',
      conversationActs: [decline], delta: { ...EMPTY, remove: [{ targetFactId: 'missing-fact' }] }, answer: null,
      metrics: { calls: 1, repairs: 0, latencyMs: 0 } });
    const result = await h.turn('追加はないです');
    expect(result.outcome).toBe(mode === 'unsupported wire' ? 'interpretation_failed' : 'rejected');
    expect(h.state()).toEqual(before);expect(h.saves()).toBe(0);
  });

  it('defaults an old checkpoint to not closed and rejects an invalid closed flag', async () => {
    const h = harness([wire()]);await h.turn('今週の相談です');
    const old = JSON.parse(h.local.checkpoint.read()!);delete old.vnext.state.optionalInvitationClosed;
    const raw = JSON.stringify(old);
    const loaded = parseWeeklyPlanningVNextSessionCheckpoint({ raw, ownerId: OWNER, weekStartDate: WEEK });
    expect(loaded?.vnext.state.optionalInvitationClosed).toBe(false);
    expect(JSON.parse(raw).vnext.state).not.toHaveProperty('optionalInvitationClosed');
    for (const flag of [null, 0, 'true']) {
      old.vnext.state.optionalInvitationClosed = flag;
      expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: JSON.stringify(old), ownerId: OWNER, weekStartDate: WEEK })).toBeNull();
    }
  });

});

describe('declining the optional invitation closes it whatever tasks exist (Astra a5946cc9)', () => {
  const doneWork: VNextAddFact[] = [{ kind: 'task', localId: 'done-task', title: '数学', category: 'study' },
    ...(['scope_total', 'completed'] as const).map(role => ({ kind: 'workload' as const, localId: role, taskRef: { localId: 'done-task' },
      componentRef: null, quantityRole: role, amount: 10, unitCode: 'page' as const, unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null }))];
  const decline: VNextEventRegistrationAct = { kind: 'decline_additional_work', targetRef: null };

  it('closes after all requested work is complete, stays closed, and writes nothing', async () => {
    const h = harness([wire(doneWork), wire([], [decline]), wire()]);
    const asked = await h.turn('数学は全10ページで10ページ終わっています');
    expect(asked.question?.optionalInvitation?.intent).toBe('all_requested_work_complete');
    const declined = await h.turn('追加はありません');
    expect(declined.outcome).toBe('noop');
    expect(declined.question).toBeNull();
    expect(h.state().optionalInvitationClosed).toBe(true);
    expect((await h.turn('変わりません')).question).toBeNull();
    expect(h.state().optionalInvitationClosed).toBe(true);
    expect(h.saves()).toBe(0);
  });

  it('keeps the required question when work remains (negative control)', async () => {
    const pending = doneWork.map(f => f.kind === 'workload' && f.quantityRole === 'completed' ? { ...f, amount: 5 } : f);
    const h = harness([wire(pending), wire([], [decline])]);
    const first = await h.turn('数学は全10ページで5ページ終わっています');
    expect(first.question?.code).toBe('missing_effort_estimate');
    const result = await h.turn('追加はありません');
    expect(result.question?.key).toBe(first.question?.key);
    expect(h.state().optionalInvitationClosed).toBe(false);
  });
});

// Run 41336860494 (head 91488442), conversation optional-invitation-busy-decline-reopen: the typed readings below are the
// model's exact output. The decline of turn 2 was not read there (3 of 3 repetitions), so the invitation stayed open.
describe('a plan request with new work after the optional invitation', () => {
  const busy: VNextAddFact[] = [{ kind: 'availability_declaration', localId: 'availability1', availabilityKind: 'unavailable',
    dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: '17:30', recurrenceKind: null, days: [],
    capacityMinutes: null, constraintLevel: 'hard' } as VNextAddFact];
  const vocab: VNextAddFact[] = [{ kind: 'task', localId: 'task_vocab', category: 'study', title: '英単語' },
    { kind: 'study_context', localId: 'context_vocab', taskRef: { localId: 'task_vocab' }, purpose: 'unknown', contextLabel: null, activityKind: 'unknown' } as VNextAddFact,
    { kind: 'workload', localId: 'work_vocab', taskRef: { localId: 'task_vocab' }, componentRef: null, quantityRole: 'target', amount: 20, unitCode: 'word',
      unitLabel: '語', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    { kind: 'effort_estimate', localId: 'estimate_vocab', taskRef: { localId: 'task_vocab' }, targetRef: { localId: 'work_vocab' }, effortKind: 'duration_per_unit',
      minutes: 2, unitCode: 'word', unitLabel: '語', precision: 'exact' } as VNextAddFact];
  const TURNS = ['11月2日から8日の予定です。11月3日16時から17時半は勉強できません。', 'ほかの作業は追加しません。', 'わかりました。',
    'やっぱり英単語を20語、1語2分で勉強する計画をお願いします。'];
  const decline = [{ kind: 'decline_additional_work', targetRef: null }] as const;
  const closedFlag = (h: ReturnType<typeof harness>) => h.local.readCheckpoint()!.vnext.state.optionalInvitationClosed;
  const communicationOf = (h: ReturnType<typeof harness>) => (h.rendererInputs[h.rendererInputs.length - 1] as { communication?: { statusReason?: string; previewAuthorization?: unknown } }).communication;
  const v5Status = (h: ReturnType<typeof harness>, previousClosed: boolean) => {
    const graph = h.state().graph;
    const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
      context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } });
    return fixedEventOnlyInteractionStatus({ graph, compilation, semanticChanged: false, previousQuestionSlot: undefined,
      declinedAdditionalWork: false, requestedEventRegistration: false, previousOptionalInvitationClosed: previousClosed });
  };

  it('with the invitation still open (decline unread), an explicit plan request with new work is authorized and previewed', async () => {
    const h = harness([wire(busy, [], 'discuss'), wire([], [], 'discuss'), wire([], [], 'unknown'), wire(vocab, [], 'create_plan')]);
    for (const text of TURNS.slice(0, 3)) {
      const result = await h.turn(text);
      // Unread decline: the optional invitation is asked again and nothing closes it.
      expect(result.question?.optionalInvitation).toBeDefined(); expect(closedFlag(h)).toBe(false);
    }
    const result = await h.turn(TURNS[3]);
    // The optional invitation was not a required question, so this explicit request authorizes the plan.
    expect(result.authorizationDecision?.authorized).toBe(true);
    expect(result.question).toBeNull();
    expect(result.preview?.blocks).toHaveLength(1);
    expect(closedFlag(h)).toBe(false);
    expect(communicationOf(h)?.previewAuthorization).toBeUndefined();
    expect(h.saved.size).toBe(0);
  });

  it('with the decline read, it closes exactly as V5 closes it and stays closed, and later new work plus a plan request previews', async () => {
    const h = harness([wire(busy, [], 'discuss'), wire([], decline as never, 'discuss'), wire([], [], 'unknown'), wire(vocab, [], 'create_plan')]);
    await h.turn(TURNS[0]);
    for (const text of TURNS.slice(1, 3)) {
      const result = await h.turn(text);
      // Same state V5 reports for the same facts (V5 baseline of the run: closed, no_additional_work, no question).
      expect(result.question).toBeNull(); expect(result.preview).toBeNull();
      expect(closedFlag(h)).toBe(true);
      expect(communicationOf(h)?.statusReason).toBe('no_additional_work');
      expect(v5Status(h, true)).toBe('no_additional_work');
    }
    const result = await h.turn(TURNS[3]);
    expect(result.authorizationDecision?.authorized).toBe(true);
    expect(result.preview?.blocks).toHaveLength(1);
    expect(closedFlag(h)).toBe(false);
  });

  it('negative control: the answer to a required question still never authorizes planning', async () => {
    const h = harness([wire([{ kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'w', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'remaining', amount: 8, unitCode: 'problem',
        unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }], [], 'discuss'), wire([], [], 'create_plan')]);
    const first = await h.turn('数学の問題は残り8問です。');
    expect(first.question?.code).toBe('missing_effort_estimate');
    const second = await h.turn('計画をお願いします。');
    expect(second.authorizationDecision?.authorized).toBe(false);
    expect(second.preview).toBeNull();
  });

  it('gives the reader the presented invitation and the guidance that its answer is the decline act', async () => {
    const h = harness([wire(busy, [], 'discuss'), wire([], decline as never, 'discuss')]);
    const requests: { messages: { role: string; content: string }[]; responseFormat?: { json_schema?: { schema?: unknown } } }[] = [];
    const complete = h.ports.client.createChatCompletion.bind(h.ports.client);
    h.ports.client.createChatCompletion = async (input) => { requests.push(input as never); return complete(input); };
    await h.turn(TURNS[0]); await h.turn(TURNS[1]);
    const second = requests[requests.length - 1];
    const userMessages = second.messages.filter(message => message.role === 'user');
    const context = JSON.parse(userMessages[userMessages.length - 1].content) as { presentedQuestion: { optionalInvitation?: { intent: string } } };
    expect(context.presentedQuestion.optionalInvitation).toMatchObject({ intent: 'missing_task_identity' });
    const schema = JSON.stringify(second.responseFormat?.json_schema?.schema);
    expect(schema).toContain('presentedQuestion with an optionalInvitation field is that invitation');
    expect(schema).toContain('decline_additional_work with an empty delta');
    // The act is about what the user said, not about which question is shown: a required question presented at the same
    // time (V5 reads the act there too) must not narrow it, and the application keeps that question.
    expect(schema).toContain('whichever question is presented');
    expect(schema).toContain('never dismiss a required question');
  });

  // N2: the renderer is told what Stable V5 tells it (HumanScale V5 "tells the renderer a status ... after a registration
  // preview"): a preview kept from an earlier turn stays shown and approvable, but only a preview this turn made is presented.
  describe('a turn that adds nothing while a preview is kept (N2, V5 renderer facts)', () => {
    const consult = '夜に集中が続かないときはどうしたらいいですか？ 今の予定はそのままで大丈夫です';
    const V5_STATUS = { actionKind: 'status', previewCount: 0, previewPromotionControlLabel: null, communication: { goal: 'acknowledge' } } as const;
    const renderFacts = (input: unknown) => { const i = input as { communication: { goal: string; statusReason?: string }; actionKind: string;
      previewCount: number; previewPromotionControlLabel: string | null; requiredLabels: string[] }; return i; };

    it('the exact Worker-run state: after a registration preview, a consultation is a status with no preview facts, and the preview stays approvable', async () => {
      const h = harness([wire(event('piano', 'non_study', '19:00', '20:00'), [request()]), wire()]);
      const first = await h.turn('11月3日19時から20時までピアノ教室があります。登録してください。');
      expect(renderFacts(h.rendererInputs[0])).toMatchObject({ actionKind: 'preview_ready', previewCount: 1, communication: { goal: 'present_preview', statusReason: 'fixed_event_registration_preview' } });
      const second = await h.turn(consult);
      const facts = renderFacts(h.rendererInputs[1]);
      expect(facts).toMatchObject({ actionKind: V5_STATUS.actionKind, previewCount: 0, previewPromotionControlLabel: null, communication: { goal: V5_STATUS.communication.goal, statusReason: 'no_additional_work' } });
      expect(facts.requiredLabels).toEqual([]);
      // V5's own decision for the same graph (the status the V5 renderer receives in the HumanScale V5 test).
      const graph = h.state().graph;
      const compilation = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph),
        context: { ownerId: OWNER, currentDate: WEEK, planningStartDate: WEEK, planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } });
      expect(fixedEventOnlyInteractionStatus({ graph, compilation, semanticChanged: false, previousQuestionSlot: undefined,
        declinedAdditionalWork: false, requestedEventRegistration: false, previousOptionalInvitationClosed: false })).toBe(facts.communication.statusReason);
      // The preview is still there (its card is shown) and approvable; nothing was saved or changed by the consultation.
      expect(second.preview).toEqual(first.preview);
      expect(h.local.readCheckpoint()?.vnext.preview).toEqual(first.preview);
      expect(h.saves()).toBe(0);
      expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
      expect(h.saves()).toBe(1);
    });

    it('control: the registration turn, a renewed explicit registration request and a turn adding a new registration still present the preview', async () => {
      const h = harness([wire(event(), [request()]), wire(), (context: Context) => wire([], [request({ factId: context.activeFacts.tasks.find(task => task.title === 'club')!.id })]),
        wire(event('piano', 'non_study', '19:00', '20:00'), [request()])]);
      await h.turn('部活を登録して');
      expect(renderFacts(h.rendererInputs[0])).toMatchObject({ actionKind: 'preview_ready', previewCount: 1 });
      await h.turn(consult);
      expect(renderFacts(h.rendererInputs[1])).toMatchObject(V5_STATUS);
      await h.turn('その予定を登録してください');
      expect(renderFacts(h.rendererInputs[2])).toMatchObject({ actionKind: 'preview_ready', previewCount: 1, communication: { goal: 'present_preview' } });
      await h.turn('ピアノ教室も11月3日19時から20時です。登録して');
      expect(renderFacts(h.rendererInputs[3])).toMatchObject({ actionKind: 'preview_ready', communication: { goal: 'present_preview' } });
    });

    it('control (D1 untouched): a study preview kept from an earlier turn is a status on a no-new-facts turn and still approves', async () => {
      const h = harness([wire(work, [], 'create_plan'), wire(), wire([], [], 'discuss', { patch: [] })]);
      const first = await h.turn('数学は60分です。予定を作って');
      expect(first.preview).not.toBeNull();
      expect(renderFacts(h.rendererInputs[0])).toMatchObject({ actionKind: 'preview_ready', communication: { goal: 'present_preview' } });
      const second = await h.turn(consult);
      expect(renderFacts(h.rendererInputs[1])).toMatchObject(V5_STATUS);
      expect(second.preview).toEqual(first.preview);
      expect(await approveWeeklyPlanningVNextExperimentalPreview({ scope, ports: h.ports })).toMatchObject({ status: 'executed', operation: { status: 'completed' } });
      expect(h.saves()).toBeGreaterThan(0);
    });
  });
});
