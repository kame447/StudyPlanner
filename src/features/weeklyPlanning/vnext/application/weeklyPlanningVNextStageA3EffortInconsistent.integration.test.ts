import { expect, it, vi } from 'vitest';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { vnextQuestionKeyAllowsProvisionalTimebox } from '../projection/weeklyPlanningVNextProjection';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'effort-inconsistent-owner', weekStartDate: '2026-11-02',
  conversationId: 'effort-inconsistent-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const facts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' },
  { kind: 'workload', localId: 'pages', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'remaining', amount: 8, unitCode: 'page', unitLabel: '枚',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
  { kind: 'effort_estimate', localId: 'rate', taskRef: { localId: 'math' }, targetRef: { localId: 'pages' },
    effortKind: 'duration_per_unit', minutes: 5, unitCode: 'page', unitLabel: '枚', precision: 'exact' },
  { kind: 'effort_estimate', localId: 'total', taskRef: { localId: 'math' }, targetRef: { localId: 'pages' },
    effortKind: 'total_duration', minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' },
];
const reading = (delta: VNextTurnDelta, planningIntent: VNextPlanningIntent = 'discuss') =>
  ({ planningIntent, conversationActs: [], delta, answer: null });
type ProviderContext = { activeFacts: { effortEstimates: { id: string; kind: string }[] };
  presentedQuestion: { key: string } };

it('changes the third unanswered effort conflict presentation while retaining the facts and existing explicit correction/deferral routes', async () => {
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
    // The oracle sees typed presentation decisions, never a change in user text or history.
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

  const asked = await turn('数学プリントは残り8枚で、1枚5分、全体60分です。この条件で予定を作ってください。');
  expect(asked.question).toMatchObject({ code: 'effort_inconsistent', options: [] });
  expect(asked.preview).toBeNull();
  expect(vnextQuestionKeyAllowsProvisionalTimebox(asked.question!.key)).toBe(false);
  const before = structuredClone(checkpoint().state);
  expect(before.graph.effortEstimates.map(estimate => [estimate.kind, estimate.minutes])).toEqual([
    ['duration_per_unit', 5], ['total_duration', 60],
  ]);
  const first = await turn('うーん');
  const second = await turn('まだ分からない');
  const third = await turn('そうですね');
  const thirdCheckpoint = raw!;
  for (const result of [first, second, third]) {
    expect(result).toMatchObject({ outcome: 'noop', graphRevision: asked.graphRevision, preview: null });
    expect(result.question).toEqual(asked.question);
  }
  expect(first.reply).toBe(second.reply);
  expect(checkpoint().state).toEqual(before);
  expect(checkpoint().unansweredQuestionStreak).toEqual({ questionKey: asked.question!.key,
    graphRevision: asked.graphRevision, count: 3 });
  expect(client.createChatCompletion).toHaveBeenCalledTimes(4);
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();

  // Both controls start from the actual third presentation and use the full provider interpreter.
  const total = before.graph.effortEstimates.find(estimate => estimate.kind === 'total_duration')!;
  const correction: VNextTurnDelta = { ...empty, patch: [{ kind: 'effort_estimate', localId: 'correct-total',
    targetFactId: total.id, changes: { minutes: 40, effortKind: null, unitCode: null, unitLabel: null, precision: null } }] };
  scripts.push(context => reading({ ...correction, patch: [{ ...correction.patch[0],
    targetFactId: context.activeFacts.effortEstimates.find(estimate => estimate.kind === 'total_duration')!.id }] }, 'update_plan'));
  const corrected = await turn('全体60分の方を40分に訂正してください。1枚5分はそのままです。');
  expect(corrected.outcome, JSON.stringify(corrected.interpretation)).toBe('applied');
  expect(corrected.appliedDelta).toEqual(correction);
  expect(corrected.question).toBeNull();
  expect(corrected.preview?.blocks).toHaveLength(1);
  // Projection owns the stated 40-minute effort; placement applies its separate buffer/rounding policy.
  expect(projectWeeklyPlanningVNext(checkpoint().state).owners[0].work[0].minutes).toBe(40);
  expect(checkpoint().state.graph.effortEstimates.filter(estimate =>
    checkpoint().state.graph.factLifecycles.some(lifecycle => lifecycle.factId === estimate.id && lifecycle.status === 'active'))
    .map(estimate => [estimate.kind, estimate.minutes])).toEqual([
    ['duration_per_unit', 5], ['total_duration', 40],
  ]);

  raw = thirdCheckpoint;
  const deferral: VNextTurnDelta = { ...empty, defer: [{ questionKey: asked.question!.key, allocation: 'none' }] };
  scripts.push(context => reading({ ...deferral,
    defer: [{ questionKey: context.presentedQuestion.key, allocation: 'none' }] }));
  const deferred = await turn('数学プリントの時間は今回は保留し、予定には入れないでください。');
  expect(deferred.outcome).toBe('applied');
  expect(deferred.appliedDelta).toEqual(deferral);
  expect(deferred.question).toBeNull();
  expect(deferred.preview).toBeNull();
  expect(checkpoint().state.deferrals).toEqual([{ ...deferral.defer[0], createdRevision: deferred.graphRevision }]);
  expect(checkpoint().state.graph.effortEstimates).toEqual(before.graph.effortEstimates);
  expect(client.createChatCompletion).toHaveBeenCalledTimes(6);
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();

  // Red-first requirement: retaining the contradiction alone does not change the method.
  expect(third.reply).not.toBe(second.reply);
});
