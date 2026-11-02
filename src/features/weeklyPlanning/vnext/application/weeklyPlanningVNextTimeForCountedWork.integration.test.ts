import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import type { WeeklyPlanDraftBlock } from '../../types';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { buildWeeklyPlanningPlanSourceId } from '../../planning/weeklyPlanningPlanProvenance';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { VNextEventRegistrationAct } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const OWNER = 'synthetic-registration-owner'; const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK,
  conversationId: 'registration-conversation', notBeforeTime: '09:00', clock: { currentDate: WEEK,
    weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } };
const EMPTY: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
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
  return { turn, local, memory, ports, slots, saved, state, rendererInputs, calls: () => calls, saves: () => saves };
}


// Run 41370698049 (reps 2 and 4), d5-negative-english-minutes T2 「英語は15分」: the model ADDED a 15-minute workload to the English task
// (which already had 15 ページ and a stated 45-minute total) instead of restating that total. The rule asserted here is a meaning rule
// in the reader's guidance; the application accepts both readings, so these controls pin what the instructed readings produce.
const task = (id: string, title: string): VNextAddFact => ({ kind: 'task', localId: id, category: 'study', title });
const workload = (id: string, taskId: string, amount: number, unitCode: string, unitLabel: string): VNextAddFact => ({ kind: 'workload',
  localId: id, taskRef: { localId: taskId }, componentRef: null, quantityRole: 'target', amount, unitCode, unitLabel, rangeStart: null,
  rangeEnd: null, perOccurrence: false, periodExpression: null } as unknown as VNextAddFact);
const total = (id: string, taskId: string, targetId: string, minutes: number): VNextAddFact => ({ kind: 'effort_estimate', localId: id,
  taskRef: { localId: taskId }, targetRef: { localId: targetId }, effortKind: 'total_duration', minutes, unitCode: null, unitLabel: null,
  precision: 'exact' } as unknown as VNextAddFact);
const SETUP = [task('math', '数学'), workload('math-w', 'math', 20, 'problem', '問'), task('english', '英語'),
  workload('english-w', 'english', 15, 'page', 'ページ'), total('english-total', 'english', 'english-w', 45)];
type Fact = { id: string };
type Context2 = { activeFacts: { effortEstimates: Fact[]; workloads: Fact[] } };
const SETUP_TEXT = '今週、数学20問と英語15ページを進めたい。英語15ページは全部で45分。';

describe('a time stated for an already counted work is an estimate, not a second workload', () => {
  const requestText = async (responses: unknown[], text: string) => {
    const h = harness(responses);
    const requests: { messages: { role: string; content: string }[] }[] = [];
    const complete = h.ports.client.createChatCompletion.bind(h.ports.client);
    h.ports.client.createChatCompletion = async input => { requests.push(input as never); return complete(input); };
    await h.turn(text);
    return requests[0].messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
  };

  it('tells the reader to state it as an effort estimate about that work and keeps the time-only rule', async () => {
    const text = await requestText([wire(SETUP, [], 'discuss')], SETUP_TEXT);
    expect(text).toContain('A time stated for a work that already has a stated quantity (in this turn or in the active facts) is a statement about expected effort');
    expect(text).toContain('never an additional minute workload');
    expect(text).toContain('Patch an existing estimate only when the user restates or corrects that same estimate (a total for a total, a rate for a rate)');
    expect(text).toContain('a newly stated estimate of a different kind (for example a total for work that already has a per-unit rate) is added, and the existing estimate stays');
    expect(text).not.toContain('a patch of its existing estimate when the user restates it');
    expect(text).toContain('the only quantity stated for a work is time (for example, reading aloud for 45 minutes), it is a workload');
    expect(text).toContain('total_duration for total time about one quantified work or owner');
    expect(text).not.toContain('英語は15分');
  });

  it('control: a work whose only stated quantity is a time stays a minute workload', async () => {
    const h = harness([wire([task('read', '音読'), workload('read-w', 'read', 45, 'minute', '分')], [], 'create_plan')]);
    const result = await h.turn('英語の音読を45分したい');
    expect(h.state().graph.workloads).toHaveLength(1); expect(h.state().graph.effortEstimates).toHaveLength(0);
    expect(slotMinutes(result)).toBe(45);
  });

  it('control: a count plus a stated total is one workload plus total_duration, and the other work is still asked', async () => {
    const h = harness([wire(SETUP, [], 'discuss')]);
    const result = await h.turn(SETUP_TEXT);
    const graph = h.state().graph;
    expect(graph.workloads).toHaveLength(2); expect(graph.effortEstimates).toHaveLength(1);
    expect(graph.effortEstimates[0]).toMatchObject({ kind: 'total_duration', minutes: 45 });
    expect(result.question).toMatchObject({ code: 'missing_effort_estimate' }); expect(h.saves()).toBe(0);
  });

  it('control: a total newly stated for work that has a stated rate is added, the rate stays, and the inconsistency is asked', async () => {
    const rate = { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'sheets' }, targetRef: { localId: 'sheets-w' }, effortKind: 'duration_per_unit',
      minutes: 5, unitCode: 'custom', unitLabel: '枚', precision: 'exact' } as unknown as VNextAddFact;
    const h = harness([wire([task('sheets', '数学プリント'), workload('sheets-w', 'sheets', 8, 'custom', '枚'), rate], [], 'discuss'),
      (context: { activeFacts: { tasks: Fact[]; workloads: Fact[] } }) => wire([{ kind: 'effort_estimate', localId: 'sheets-total',
        taskRef: { factId: context.activeFacts.tasks[0].id }, targetRef: { factId: context.activeFacts.workloads[0].id }, effortKind: 'total_duration',
        minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' } as unknown as VNextAddFact], [], 'discuss')]);
    await h.turn('数学プリントは残り8枚で、1枚5分です。');
    const second = await h.turn('この残り8枚の全体には60分かかります。');
    const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(h.state().graph);
    expect(graph.effortEstimates.map(estimate => `${estimate.kind}:${estimate.minutes}`).sort()).toEqual(['duration_per_unit:5', 'total_duration:60']);
    expect(second.question).toMatchObject({ code: 'effort_inconsistent' }); expect(h.saves()).toBe(0);
  });

  it('control: restating the total patches the estimate, keeps both workloads, and still asks the math estimate', async () => {
    const h = harness([wire(SETUP, [], 'discuss'), (context: Context2) => ({ planningIntent: 'update_plan', conversationActs: [], answer: null,
      delta: { ...EMPTY, patch: [{ kind: 'effort_estimate', localId: 'edit', targetFactId: context.activeFacts.effortEstimates[0].id,
        changes: { minutes: 15, effortKind: null, unitCode: null, unitLabel: null, precision: null } }] } })]);
    await h.turn(SETUP_TEXT);
    const second = await h.turn('英語は15分');
    const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(h.state().graph);
    expect(graph.workloads).toHaveLength(2); expect(graph.effortEstimates).toHaveLength(1);
    expect(graph.effortEstimates[0]).toMatchObject({ kind: 'total_duration', minutes: 15 });
    expect(second.question).toMatchObject({ code: 'missing_effort_estimate' }); expect(h.saves()).toBe(0);
  });
});

const slotMinutes = (result: { preview: { blocks: Array<{ startTime: string; endTime: string }> } | null }) =>
  (result.preview?.blocks ?? []).reduce((sum, block) => sum + (minutesOf(block.endTime) - minutesOf(block.startTime)), 0);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
