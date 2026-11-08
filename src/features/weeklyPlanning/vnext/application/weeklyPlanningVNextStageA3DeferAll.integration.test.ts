import { expect, it, vi } from 'vitest';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'defer-all-owner', weekStartDate: '2026-11-02',
  conversationId: 'defer-all-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const work = (id: string, title: string, amount: number): VNextAddFact[] => [
  { kind: 'task', localId: id, category: 'study', title },
  { kind: 'workload', localId: `${id}-w`, taskRef: { localId: id }, componentRef: null, quantityRole: 'target', amount, unitCode: 'page',
    unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];
const facts: VNextAddFact[] = [...work('math', '数学', 20), ...work('eng', '英語', 15), ...work('phys', '物理', 10)];
const reading = (delta: VNextTurnDelta, planningIntent: VNextPlanningIntent = 'discuss') =>
  ({ planningIntent, conversationActs: [], delta, answer: null });
type ProviderContext = { activeFacts: { workloads: { id: string; quantityRole: string }[] };
  presentedQuestion: { key: string } };

it('a provider reading that defers every pending question with a provisional timebox is applied by the session, not rejected', async () => {
  const scripts: Array<ReturnType<typeof reading> | ((context: ProviderContext) => ReturnType<typeof reading>)> =
    [reading({ ...empty, add: facts }, 'create_plan')];
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

  const asked = await turn('数学は20枚、英語は15枚、物理は10枚です。この条件で予定を作ってください。');
  expect(asked.question).toMatchObject({ code: 'missing_effort_estimate' });
  expect(checkpoint().state.deferrals).toEqual([]);

  scripts.push(context => reading({ ...empty, defer: [{ questionKey: context.presentedQuestion.key, allocation: 'provisional_timebox', scope: 'all_pending' } as never] }, 'create_plan'));
  const deferred = await turn('どれも時間は分からないから、仮でいいから全部入れて');
  expect(deferred.outcome, JSON.stringify(deferred.interpretation)).toBe('applied');
  expect(deferred.interpretation).toMatchObject({ status: 'interpreted', metrics: { repairs: 0 } });
  // One utterance deferred all three pending questions; what is stored is the ordinary per-question shape.
  expect(checkpoint().state.deferrals.map(item => item.allocation)).toEqual(['provisional_timebox', 'provisional_timebox', 'provisional_timebox']);
  expect(checkpoint().state.deferrals.every(item => Object.keys(item).sort().join() === 'allocation,createdRevision,questionKey')).toBe(true);
  expect(deferred.question).toBeNull();
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();
});
