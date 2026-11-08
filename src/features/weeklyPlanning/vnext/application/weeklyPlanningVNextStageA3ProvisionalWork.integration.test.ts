import { expect, it, vi } from 'vitest';
import type { VNextAddFact, VNextPlanningIntent, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { parseWeeklyPlanningVNextSessionCheckpoint } from './weeklyPlanningVNextSessionCheckpoint';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: 'provisional-work-owner', weekStartDate: '2026-11-02',
  conversationId: 'provisional-work-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-02', planningStartDate: '2026-11-02',
    planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' },
};
const empty: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };
const facts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学プリント' },
  { kind: 'workload', localId: 'work', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'target', amount: 8,
    unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
];
const reading = (delta: VNextTurnDelta, planningIntent: VNextPlanningIntent = 'discuss') =>
  ({ planningIntent, conversationActs: [], delta, answer: null });
type ProviderContext = { activeFacts: { tasks: { id: string }[]; workloads: { id: string; quantityRole: string }[] };
  presentedQuestion: { key: string } };

it('tells the renderer a provisionally placed work is provisional, and only while that preview is the one shown', async () => {
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
        requiredLabels: input.requiredLabels, previewCount: input.previewCount, provisionalWork: input.communication?.provisionalWork ?? null }) }) }),
  };
  const checkpoint = () => parseWeeklyPlanningVNextSessionCheckpoint({ raw: raw!,
    ownerId: scope.ownerId, weekStartDate: scope.weekStartDate })!.vnext;
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText,
    turnId: `turn-${++sequence}`, shownRevision: raw === null ? null : checkpoint().presentedQuestion?.graphRevision ?? null });

  const asked = await turn('数学プリントは8枚です。この条件で予定を作ってください。');
  expect(asked.question).toMatchObject({ code: 'missing_effort_estimate' });
  expect(asked.preview).toBeNull();
  const shown = (result: { reply: string }) => JSON.parse(result.reply) as { goal: string | null; actionKind: string; provisionalWork: unknown };
  expect(shown(asked).provisionalWork).toBeNull();

  scripts.push(context => reading({ ...empty, defer: [{ questionKey: context.presentedQuestion.key, allocation: 'provisional_timebox' }] }, 'create_plan'));
  const provisional = await turn('時間は分からないので、仮で置いてください。');
  expect(provisional.outcome, JSON.stringify(provisional.interpretation)).toBe('applied');
  expect(provisional.preview).not.toBeNull();
  // The preview places the work with the provisional timebox, and the renderer is told so as a typed fact.
  expect(shown(provisional)).toMatchObject({ actionKind: 'preview_ready', provisionalWork: [{ label: '数学プリント', minutes: 60 }] });
  expect(saveBlock).not.toHaveBeenCalled();
  expect(approvalWrite).not.toHaveBeenCalled();

  // A stated estimate replaces the provisional block: the new preview carries no provisional fact.
  scripts.push(context => reading({ ...empty, add: [{ kind: 'effort_estimate', localId: 'estimate', taskRef: { factId: context.activeFacts.tasks[0].id },
    targetRef: { factId: context.activeFacts.workloads[0].id }, effortKind: 'total_duration', minutes: 40, unitCode: null, unitLabel: null,
    precision: 'exact' }] }, 'create_plan'));
  const estimated = await turn('全部で40分です。');
  expect(estimated.outcome, JSON.stringify(estimated.interpretation)).toBe('applied');
  expect(estimated.preview).not.toBeNull();
  expect(shown(estimated).provisionalWork).toBeNull();
});
