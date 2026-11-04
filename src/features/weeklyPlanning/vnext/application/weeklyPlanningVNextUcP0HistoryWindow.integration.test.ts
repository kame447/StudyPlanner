import { expect, it, vi } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const WEEK = '2026-11-02';
const firstText = '数学の作業量は60分です。';
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const facts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'work', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];
const reading = (delta: Partial<VNextTurnDelta> = {}, planningIntent: VNextPlanningIntent = 'discuss') =>
  ({ planningIntent, conversationActs: [], delta: { ...empty, ...delta }, answer: null });
type ProviderContext = {
  userText: string;
  recentConversation: { role: string; content: string }[];
  activeFacts: { workloads?: { id: string; amount: number }[] };
};
type Script = ReturnType<typeof reading> | ((context: ProviderContext) => ReturnType<typeof reading>);

it('keeps corrected active facts after older messages leave the window and isolates owners and conversations', async () => {
  const storage = createMemoryStorageHarness().storage;
  const saveBlock = vi.fn(async () => { throw new Error('unexpected plan save'); });
  const approvalWrite = vi.fn(() => { throw new Error('unexpected approval write'); });
  function harness(ownerId: string, conversationId: string, scripts: Script[]) {
    const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate: WEEK, chatId: conversationId, storage,
      legacyV5Raw: null });
    const scope: WeeklyPlanningVNextExperimentalScope = { ownerId, conversationId, weekStartDate: WEEK,
      notBeforeTime: '09:00', clock: { currentDate: WEEK, planningStartDate: WEEK,
        planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' } };
    const captures: Pick<WeeklyPlanningVNextInterpretationInput, 'state' | 'recentConversation'>[] = [];
    const prompts: ProviderContext[] = [];
    const realInterpreter = createWeeklyPlanningVNextProviderInterpreter();
    const ports: WeeklyPlanningVNextExperimentalPorts = {
      checkpoint: local.checkpoint, legacyV5Checkpoint: local.legacyV5Checkpoint,
      interpret: async input => {
        captures.push(structuredClone({ state: input.state, recentConversation: input.recentConversation }));
        return realInterpreter(input);
      },
      client: { async createChatCompletion(request) {
        const context = JSON.parse(request.messages[1].content) as ProviderContext;
        prompts.push(context);
        const next = scripts.shift();
        if (!next) throw new Error('synthetic provider script exhausted');
        return JSON.stringify(typeof next === 'function' ? next(context) : next);
      } },
      approvalLedger: { read: () => null, write: approvalWrite },
      plans: { findExistingPlanId: async () => undefined, saveBlock },
      calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
      now: () => '2026-11-02T09:00:00.000Z',
      createRenderer: () => ({ render: async () => ({ status: 'rendered', text: '条件を受け取りました。', rawResponse: '' }) }),
    };
    let sequence = 0;
    const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({
      scope, ports, userText, turnId: `turn-${++sequence}`,
      shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null,
    });
    return { local, captures, prompts, turn };
  }

  const primary = harness('owner-a', 'conversation-a', [
    reading({ add: facts }), reading(),
    context => reading({ patch: [{ kind: 'workload', localId: 'correct-work',
      targetFactId: context.activeFacts.workloads![0].id, amountDelta: null,
      changes: { amount: 90, quantityRole: null, unitCode: null, unitLabel: null, rangeStart: null,
        rangeEnd: null, perOccurrence: null, periodExpression: null } }] }, 'update_plan'),
    reading(),
  ]);
  expect((await primary.turn(firstText)).outcome).toBe('applied');
  expect((await primary.turn('条件を確認します。')).outcome).toBe('noop');
  expect((await primary.turn('60分ではなく90分に訂正します。')).outcome).toBe('applied');
  const before = structuredClone(primary.local.readCheckpoint()!.vnext);
  expect(before.messages).toHaveLength(4);
  expect((await primary.turn('続けてください。')).outcome).toBe('noop');
  const input = primary.captures[3];
  const prompt = primary.prompts[3];

  // Conversation history and accepted facts are separate boundaries.
  expect(input.recentConversation).toEqual(before.messages);
  expect(prompt.recentConversation).toEqual(before.messages);
  expect(prompt.recentConversation.map(message => message.content)).not.toContain(firstText);
  expect(prompt.recentConversation.map(message => message.content)).toContain('60分ではなく90分に訂正します。');

  const graph = input.state.graph;
  const oldFact = graph.workloads.find(fact => fact.amount === 60)!;
  const newFact = graph.workloads.find(fact => fact.amount === 90)!;
  expect(oldFact).toBeDefined();
  expect(newFact).toBeDefined();
  expect(graph.factLifecycles.find(item => item.factId === oldFact.id))
    .toMatchObject({ status: 'superseded', supersededByFactId: newFact.id });
  expect(graph.factLifecycles.find(item => item.factId === newFact.id)).toMatchObject({ status: 'active' });
  const activeIds = new Set(graph.factLifecycles.filter(item => item.status === 'active').map(item => item.factId));
  expect(graph.workloads.filter(fact => activeIds.has(fact.id)).map(fact => fact.amount)).toEqual([90]);
  expect(prompt.activeFacts.workloads?.map(fact => fact.amount)).toEqual([90]);

  const retained = primary.local.checkpoint.read();
  for (const [owner, conversation] of [['owner-b', 'conversation-b'], ['owner-a', 'conversation-b']]) {
    const control = harness(owner, conversation, [reading()]);
    expect(control.local.checkpoint.read()).toBeNull();
    expect((await control.turn('新しい会話です。')).outcome).toBe('noop');
    expect(control.captures[0].recentConversation).toEqual([]);
    expect(control.captures[0].state.graph.workloads).toEqual([]);
    expect(control.prompts[0].recentConversation).toEqual([]);
    expect(control.prompts[0].activeFacts.workloads ?? []).toEqual([]);
    expect(primary.local.checkpoint.read()).toBe(retained);
  }
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();
});
