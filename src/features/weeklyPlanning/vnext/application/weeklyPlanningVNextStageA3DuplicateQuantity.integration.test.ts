import { expect, it, vi } from 'vitest';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { projectWeeklyPlanningVNext, vnextQuestionKeyAllowsProvisionalTimebox } from '../projection/weeklyPlanningVNextProjection';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { VNEXT_REPEATED_DUPLICATE_QUANTITY_CHOICES_GUIDANCE } from './weeklyPlanningVNextDialogue';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'duplicate-quantity-owner', weekStartDate: '2026-11-02',
  conversationId: 'duplicate-quantity-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const facts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' },
  { kind: 'workload', localId: 'first', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'scope_total', amount: 20, unitCode: 'page', unitLabel: '枚',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  { kind: 'workload', localId: 'second', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'scope_total', amount: 30, unitCode: 'page', unitLabel: '枚',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];
const reading = (delta: VNextTurnDelta, planningIntent: VNextPlanningIntent = 'discuss') =>
  ({ planningIntent, conversationActs: [], delta, answer: null });
type ProviderContext = { activeFacts: { workloads: { id: string; quantityRole: string }[] };
  presentedQuestion: { key: string; options: { optionId: string; value: number }[] } };

it('changes the third unanswered duplicate-quantity presentation while preserving facts and explicit correction/deferral', async () => {
  const scripts: Array<ReturnType<typeof reading> | ((context: ProviderContext) => ReturnType<typeof reading>)> =
    [reading({ ...empty, add: facts }, 'create_plan'), reading(empty), reading(empty), reading(empty)];
  let raw: string | null = null;
  const saveBlock = vi.fn(async () => { throw new Error('unexpected Plan save'); });
  const approvalWrite = vi.fn(() => { throw new Error('unexpected approval write'); });
  const client = { createChatCompletion: vi.fn(async (input: Parameters<WeeklyPlanningVNextExperimentalPorts['client']['createChatCompletion']>[0]) => {
    const next = scripts.shift();
    if (!next) throw new Error('synthetic provider script exhausted');
    return JSON.stringify(typeof next === 'function' ? next(JSON.parse(input.messages[1].content)) : next);
  }) };
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    client, interpret: createWeeklyPlanningVNextProviderInterpreter(),
    checkpoint: { read: () => raw, write: value => { raw = value; } },
    legacyV5Checkpoint: { read: () => null },
    approvalLedger: { read: () => null, write: approvalWrite },
    plans: { findExistingPlanId: async () => undefined, saveBlock },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => '2026-11-02T09:00:00.000Z',
    // Only typed presentation decisions; no history, turn ID or user wording.
    createRenderer: () => ({ render: async input => ({ status: 'rendered', rawResponse: '',
      text: JSON.stringify({ goal: input.communication?.goal ?? null, actionKind: input.actionKind,
        questionCode: input.questionCode, questionIntent: input.questionIntent,
        requiredLabels: input.requiredLabels, previewCount: input.previewCount }) }) }),
  };
  const checkpoint = () => parseWeeklyPlanningVNextSessionCheckpoint({ raw: raw!,
    ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })!.vnext;
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
    turnId: `turn-${++sequence}`, shownRevision: raw === null ? null : checkpoint().presentedQuestion?.graphRevision ?? null });

  const asked = await turn('数学プリントは全体20枚です。いえ、全体30枚です。この条件で予定を作ってください。');
  expect(asked.interpretation).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
  expect(asked.question).toMatchObject({ code: 'duplicate_quantity' });
  expect(asked.preview).toBeNull();
  expect(vnextQuestionKeyAllowsProvisionalTimebox(asked.question!.key)).toBe(false);
  const before = structuredClone(checkpoint().state);
  expect(before.graph.workloads.map(workload => [workload.quantityRole, workload.amount])).toEqual([
    ['scope_total', 20], ['scope_total', 30],
  ]);
  const results = [];
  for (const text of ['うーん', 'まだ分からない', 'そうですね']) {
    results.push(await turn(text));
    expect(checkpoint().state).toEqual(before);
  }
  const [first, second, third] = results;
  const thirdCheckpoint = raw!;
  for (const result of results) {
    expect(result).toMatchObject({ outcome: 'noop', graphRevision: asked.graphRevision, preview: null });
    expect(result.question).toEqual(asked.question);
  }
  expect(first.reply).toBe(second.reply);
  expect(checkpoint().unansweredQuestionStreak).toEqual({ questionKey: asked.question!.key,
    graphRevision: asked.graphRevision, count: 3 });
  expect(client.createChatCompletion).toHaveBeenCalledTimes(4);
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();

  // Both controls branch independently from the third actual checkpoint.
  const [firstTotal] = before.graph.workloads;
  const correction: VNextTurnDelta = { ...empty, remove: [{ targetFactId: firstTotal.id }] };
  scripts.push(context => reading({ ...correction, remove: [{ targetFactId: context.activeFacts.workloads[0].id }] }, 'update_plan'));
  const corrected = await turn('全体は30枚が正しいので、20枚は取り消してください。');
  expect(corrected.outcome, JSON.stringify(corrected.interpretation)).toBe('applied');
  expect(corrected.appliedDelta).toEqual(correction);
  expect(corrected.question?.code).toBe('missing_effort_estimate');
  expect(corrected.preview).toBeNull();
  const graph = checkpoint().state.graph;
  const active = new Set(graph.factLifecycles.filter(lifecycle => lifecycle.status === 'active').map(lifecycle => lifecycle.factId));
  expect(graph.workloads.filter(workload => active.has(workload.id)).map(workload => [workload.quantityRole, workload.amount]))
    .toEqual([['scope_total', 30]]);
  expect(projectWeeklyPlanningVNext(checkpoint().state).questions[0]?.code).toBe('missing_effort_estimate');

  // Choosing one of the shown options is an ordinary option answer: the other statement goes, and the work moves on.
  raw = thirdCheckpoint;
  scripts.push(context => ({ ...reading(empty), answer: { kind: 'option', optionId: context.presentedQuestion.options.find(option => option.value === 30)!.optionId,
    minutes: null, per: null } } as never));
  const chosen = await turn('30枚の方だけにします');
  expect(chosen.outcome, JSON.stringify(chosen.interpretation)).toBe('applied');
  expect(chosen.question?.code).toBe('missing_effort_estimate');
  const chosenGraph = checkpoint().state.graph;
  const live = new Set(chosenGraph.factLifecycles.filter(lifecycle => lifecycle.status === 'active').map(lifecycle => lifecycle.factId));
  expect(chosenGraph.workloads.filter(workload => live.has(workload.id)).map(workload => workload.amount)).toEqual([30]);

  raw = thirdCheckpoint;
  const deferral: VNextTurnDelta = { ...empty, defer: [{ questionKey: asked.question!.key, allocation: 'none' }] };
  scripts.push(context => reading({ ...deferral,
    defer: [{ questionKey: context.presentedQuestion.key, allocation: 'none' }] }));
  const deferred = await turn('数量の確認は今回は保留し、予定には入れないでください。');
  expect(deferred.outcome, JSON.stringify(deferred.interpretation)).toBe('applied');
  expect(deferred.appliedDelta).toEqual(deferral);
  expect(deferred.question).toBeNull();
  expect(deferred.preview).toBeNull();
  expect(checkpoint().state.deferrals).toEqual([{ ...deferral.defer[0], createdRevision: deferred.graphRevision }]);
  expect(checkpoint().state.graph.workloads).toEqual(before.graph.workloads);
  expect(client.createChatCompletion).toHaveBeenCalledTimes(7);
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();

  // Red-first: a change in the typed presentation is required, not just a different utterance.
  expect(third.reply).not.toBe(second.reply);
  const shown = (result: { reply: string }) => JSON.parse(result.reply) as { goal: string | null; requiredLabels: string[] };
  expect(shown(second)).toMatchObject({ goal: 'ask_question' });
  expect(shown(third)).toMatchObject({ goal: 'explain_question' });
  expect(shown(third).requiredLabels).toEqual(expect.arrayContaining([VNEXT_REPEATED_DUPLICATE_QUANTITY_CHOICES_GUIDANCE, '全体20枚', '全体30枚',
    '20枚の方だけにする', '30枚の方だけにする']));
  expect(shown(second).requiredLabels).not.toContain(VNEXT_REPEATED_DUPLICATE_QUANTITY_CHOICES_GUIDANCE);
});
