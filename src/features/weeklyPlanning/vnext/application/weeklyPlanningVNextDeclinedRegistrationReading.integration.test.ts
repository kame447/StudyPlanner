import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanDraftBlock } from '../../types';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { projectWeeklyPlanningFixedEventRegistration } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { buildWeeklyPlanningPlanSourceId } from '../../planning/weeklyPlanningPlanProvenance';
import type { VNextEventRegistrationAct } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

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


// Runs 41342699221 ... 41364224405 (18 reps): "ゼミがありますが、予定表には入れなくていいです" was read as an unavailable availability_declaration 13 times,
// as a non_study task with a hard fixed_interval 4 times and as an unknown-category task once; V5 read busy time 15 of 15. The readings
// below are the model's exact typed output shapes. The guidance asserted here is the meaning rule that makes the first reading the
// instructed one; whichever reading arrives, the application keeps the commitment as busy time.
const busyReading = (): VNextAddFact[] => [{ kind: 'availability_declaration', localId: 'seminar_busy', availabilityKind: 'unavailable',
  dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: '17:30', recurrenceKind: null, days: [],
  capacityMinutes: null, constraintLevel: 'hard' } as unknown as VNextAddFact];
const movable = (minutes: number): VNextAddFact[] => [
  { kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'math-work', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'remaining',
    amount: minutes, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  { kind: 'task_date_rule', localId: 'day', taskRef: { localId: 'math' }, targetRef: { localId: 'math' }, ruleKind: 'allowed_date',
    dateExpression: '2026-11-03', constraintLevel: 'hard' },
  { kind: 'temporal_constraint', localId: 'from', taskRef: { localId: 'math' }, targetRef: { localId: 'math' }, constraintKind: 'earliest_start',
    constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null, startTime: '16:00', endTime: null, precision: 'exact' },
  { kind: 'temporal_constraint', localId: 'to', taskRef: { localId: 'math' }, targetRef: { localId: 'math' }, constraintKind: 'latest_end',
    constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null, startTime: null, endTime: '19:30', precision: 'exact' },
] as unknown as VNextAddFact[];
const slots = (result: { preview: { blocks: Array<{ date: string; startTime: string; endTime: string }> } | null }) =>
  (result.preview?.blocks ?? []).map(block => `${block.date} ${block.startTime}-${block.endTime}`);
const DECLINED = '11月3日16時から17時半までゼミがありますが、予定表には入れなくていいです。';

type Request = { messages: { role: string; content: string }[]; responseFormat?: { json_schema?: { schema?: unknown } } };
function recording(h: ReturnType<typeof harness>) {
  const requests: Request[] = [];
  const complete = h.ports.client.createChatCompletion.bind(h.ports.client);
  h.ports.client.createChatCompletion = async input => { requests.push(input as never); return complete(input); };
  return requests;
}

describe('a fixed time the user declines to register is read as busy time (release gate, fixed-event-registration-negated)', () => {
  it('tells the reader to state it as hard unavailable busy time, with no task and no registration act', async () => {
    const h = harness([wire(busyReading(), [], 'discuss')]); const requests = recording(h);
    await h.turn(DECLINED);
    const text = `${requests[0].messages.filter(message => message.role === 'system').map(message => message.content).join('\n')}${JSON.stringify(requests[0].responseFormat?.json_schema?.schema)}`;
    expect(text).toContain('need not be registered or put on the calendar');
    expect(text).toContain('unavailable availability_declaration (hard)');
    expect(text).toContain('no task for it and no request_event_registration');
    // The meaning rule carries no user wording: no phrase of the user's sentence is quoted in it.
    expect(text).not.toContain('予定表には入れなくていい');
  });

  it('keeps the unaffected guidance: fixed time alone, explicit registration, and the decline of additional work', async () => {
    const h = harness([wire(busyReading(), [], 'discuss')]); const requests = recording(h);
    await h.turn(DECLINED);
    const text = `${requests[0].messages.filter(message => message.role === 'system').map(message => message.content).join('\n')}${JSON.stringify(requests[0].responseFormat?.json_schema?.schema)}`;
    expect(text).toContain('A fixed time alone is busy information, not a registration request.');
    expect(text).toContain('An explicit registration request is a task with fixed_interval plus request_event_registration.');
    expect(text).toContain('whichever question is presented');
    expect(text).toContain('never dismiss a required question');
    expect(text).toContain('decline_additional_work with an empty delta');
  });

  it('the busy reading keeps the optional invitation open, adds no registration candidate and saves nothing', async () => {
    const h = harness([wire(busyReading(), [], 'discuss')]);
    const result = await h.turn(DECLINED);
    expect(result.question).toMatchObject({ code: 'missing_schedulable_work' });
    expect(result.preview).toBeNull(); expect(result.draftCandidates ?? []).toEqual([]); expect(h.saves()).toBe(0);
    expect(h.state().graph.tasks).toHaveLength(0); expect(h.state().graph.availabilityDeclarations).toHaveLength(1);
    expect((h.rendererInputs[0] as { communication: { statusReason?: string } }).communication.statusReason).toBeUndefined();
  });

  it('a declined registration with study work in the same turn still plans around the busy time', async () => {
    const h = harness([wire([...busyReading(), ...movable(30)], [], 'create_plan')]);
    const result = await h.turn(`${DECLINED}その日に数学を30分、16時から19時半の間でやりたいです。予定を作って`);
    expect(slots(result)).toEqual(['2026-11-03 17:40-18:10']);
    expect(h.saves()).toBe(0);
  });

  it('boundary: an explicit registration request still yields the registration candidate', async () => {
    const h = harness([wire(event('seminar'), [request({ localId: 'seminar' })], 'discuss')]);
    const result = await h.turn('11月3日16時から17時半までseminarがあります。予定表に載せといて。');
    expect(result.draftCandidates).toHaveLength(1); expect(result.draftCandidates?.[0]).toMatchObject({ source: 'fixed_event_registration' });
    expect(h.saves()).toBe(0);
  });

  it('boundary: a fixed time with no registration intent stays busy information', async () => {
    const h = harness([wire(busyReading(), [], 'discuss')]);
    const result = await h.turn('11月3日16時から17時半まではゼミなので、その間は勉強できません。');
    expect(result.preview).toBeNull(); expect(result.draftCandidates ?? []).toEqual([]);
  });
});
