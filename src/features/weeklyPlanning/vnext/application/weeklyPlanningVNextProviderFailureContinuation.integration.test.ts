// #973 Stage A: a scripted provider fails after past study records and an unsaved plan exist.
// These tests deliberately exercise the current integration boundary without a Worker or network.
import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts,
  type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';

const OWNER = 'stage-a-provider-owner';
const WEEK = '2026-11-02';
const scope: WeeklyPlanningVNextExperimentalScope = {
  ownerId: OWNER, weekStartDate: WEEK, conversationId: 'stage-a-provider-conversation', notBeforeTime: '09:00',
  clock: { currentDate: '2026-11-03', weekStartsOn: 'monday', timeZone: 'Asia/Tokyo',
    planningStartDate: WEEK, planningEndDate: '2026-11-08' },
};
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const record = (dateExpression: string, subject: string, minutes: number) => ({ dateExpression, subject, minutes });
const reading = (studyRecords: unknown[]) => ({ planningIntent: 'discuss', conversationActs: [],
  delta: EMPTY, studyRecords, studyRecordQuestion: null, studyRestDays: [], answer: null });
const planFacts: VNextAddFact[] = [
  { kind: 'task', localId: 'math', category: 'study', title: '数学' },
  { kind: 'workload', localId: 'math-minutes', taskRef: { localId: 'math' }, componentRef: null,
    quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
    perOccurrence: false, periodExpression: null },
];
const planReading = { planningIntent: 'create_plan', conversationActs: [],
  delta: { ...EMPTY, add: planFacts }, studyRecords: [], studyRecordQuestion: null, studyRestDays: [], answer: null };

function harness(script: Array<unknown | Error>) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const providerInputs: Array<Record<string, unknown>> = [];
  const savedPlans: unknown[] = [];
  let rendererCalls = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = {
    checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(),
    client: { async createChatCompletion(request) {
      providerInputs.push(JSON.parse(request.messages[1].content));
      const next = script.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('script exhausted');
      return JSON.stringify(next);
    } },
    approvalLedger: { read: () => null, write: () => { throw new Error('unexpected approval write'); } },
    plans: { findExistingPlanId: async () => undefined, async saveBlock(block) {
      savedPlans.push(block); return { planId: `plan:${block.id}` };
    } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }),
    now: () => '2026-11-03T00:00:00.000Z',
    createRenderer: () => ({ async render() {
      rendererCalls++;
      return { status: 'rendered', text: '仮の予定案を確認してください。まだ保存していません。', rawResponse: '' };
    } }),
  };
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({
    scope, ports, userText, turnId: `turn-${++sequence}`,
    shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null,
  });
  const stored = () => local.readCheckpoint()!.vnext;
  return { turn, stored, providerInputs, savedPlans, rendererCalls: () => rendererCalls };
}

async function prepared(scriptAfterSetup: Array<unknown | Error>) {
  const h = harness([
    reading([record('2026-10-26', '数学', 60), record('2026-10-27', '英語', 45)]),
    planReading,
    ...scriptAfterSetup,
  ]);
  const records = await h.turn('先週は月曜に数学60分、火曜に英語45分勉強しました。');
  expect(records.outcome).toBe('applied');
  expect(records.actualRecords).toHaveLength(2);
  const plan = await h.turn('今週の数学を60分、この条件で予定を作ってください。');
  expect(plan.outcome).toBe('applied');
  expect(plan.preview).not.toBeNull();
  expect(h.stored().state.graph.workloads).toHaveLength(1);
  return h;
}

describe('Stage A: provider failure in a later study-record conversation turn', () => {
  it('retains records, plan facts and the tentative preview; accepts the next utterance without saving', async () => {
    const h = await prepared([new Error('synthetic provider 500'),
      reading([record('2026-10-28', '化学', 30)])]);
    const before = structuredClone(h.stored());
    const failure = await h.turn('水曜は化学を40分勉強しました。');
    expect(failure.outcome).toBe('interpretation_failed');
    expect(failure.interpretation).toMatchObject({ status: 'failed', reason: 'provider_error' });
    expect(h.stored().actualRecords).toEqual(before.actualRecords);
    expect(h.stored().state.graph).toEqual(before.state.graph);
    expect(h.stored().preview).toEqual(before.preview);
    expect(h.stored().actualRecords?.every(item => item.status === 'pending')).toBe(true);
    expect(h.stored().messages.slice(-2)[0]?.content).toBe('水曜は化学を40分勉強しました。');
    expect(h.savedPlans).toEqual([]);
    expect(failure.reply).not.toMatch(/保存しました|記録しました/u);

    const resumed = await h.turn('水曜は化学30分でした。');
    expect(resumed.outcome).toBe('applied');
    expect(resumed.actualRecords?.map(item => `${item.occurrenceDate}:${item.minutes}`))
      .toEqual(['2026-10-26:60', '2026-10-27:45', '2026-10-28:30']);
    expect(resumed.preview).toEqual(before.preview);
    expect(h.savedPlans).toEqual([]);
  });

  it('does not blame the user wording for a technical failure', async () => {
    const h = await prepared([new Error('synthetic provider 500')]);
    const failure = await h.turn('水曜は化学を40分勉強しました。');
    expect(failure.outcome).toBe('interpretation_failed');
    expect(failure.interpretation).toMatchObject({ status: 'failed', reason: 'provider_error' });
    expect(failure.reply).not.toMatch(/言い方を変えて|説明し直して/u);
  });

  it('explicitly says that the failed input was not applied', async () => {
    const h = await prepared([new Error('synthetic provider 500')]);
    const failure = await h.turn('水曜は化学を40分勉強しました。');
    expect(failure.outcome).toBe('interpretation_failed');
    expect(failure.interpretation).toMatchObject({ status: 'failed', reason: 'provider_error' });
    expect(failure.reply).toMatch(/今回.*(?:反映|適用).*ません/u);
  });

  it('changes the recovery guidance after the same technical failure repeats', async () => {
    const h = await prepared([new Error('synthetic provider 500'), new Error('synthetic provider 500')]);
    const first = await h.turn('水曜は化学を40分勉強しました。');
    const second = await h.turn('水曜は化学を40分勉強しました。');
    expect(first.outcome).toBe('interpretation_failed');
    expect(second.outcome).toBe('interpretation_failed');
    expect(h.stored().actualRecords).toHaveLength(2);
    expect(h.stored().preview).not.toBeNull();
    expect(h.savedPlans).toEqual([]);
    expect(second.reply).not.toBe(first.reply);
  });
});
