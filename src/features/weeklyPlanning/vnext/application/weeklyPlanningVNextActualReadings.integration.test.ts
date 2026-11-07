// #973 I4: the scripted readings of the study-record E2E (tests/e2e/support/vnext-actual-readings.mjs, answered by the synthetic
// provider in emulator/vnext-actual-record.emulator.mjs) must be accepted by the real VNext provider interpreter (strict decoder,
// dry-run) and do through the real session what the browser spec asserts. They are not checked against the application's own
// output: the expected rows and totals are the fixed scenario (ARGON-FIRST.md). Each turn makes exactly the provider calls the spec
// answers: one reading, and a renderer call only when the reply is not the application's fixed text.
import { describe, expect, it } from 'vitest';
// @ts-expect-error The e2e support module is plain ESM without declarations.
import { RECORD_ONLY_KINDS, scriptedActualReading } from '../../../../../tests/e2e/support/vnext-actual-readings.mjs';
// @ts-expect-error The e2e support module is plain ESM without declarations.
import { scriptedReading } from '../../../../../tests/e2e/support/vnext-scripted-readings.mjs';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { submitWeeklyPlanningVNextExperimentalTurn, type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { formatRestDaysReply, sumActualRecordMinutes } from '../../application/weeklyPlanningActualRecords';

const OWNER = 'synthetic-actual-e2e-owner'; const WEEK = '2026-11-02'; const TODAY = '2026-11-03';
const RECORDED_WEEK = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK, conversationId: 'actual-e2e-conversation',
  notBeforeTime: '09:00', clock: { currentDate: TODAY, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } };
type Context = { activeFacts: { workloads: { id: string }[] } };

function harness(kinds: string[]) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const script = [...kinds];
  let readings = 0; let renders = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion(input) {
      const kind = script.shift(); if (!kind) throw new Error('synthetic script exhausted'); readings++;
      const context = JSON.parse(input.messages[1].content) as Context;
      return JSON.stringify(kind === 'plan'
        ? scriptedReading('plan', { title: '数学', date: '2026-11-04' }, context)
        : scriptedActualReading(kind, { week: RECORDED_WEEK }));
    } }, approvalLedger: { read: () => null, write: () => undefined },
    plans: { findExistingPlanId: async () => undefined, async saveBlock(block) { return { planId: `plan:${block.id}` }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => `${TODAY}T00:00:00.000Z`,
    createRenderer: () => ({ async render() { renders++; return { status: 'rendered', text: '合成の返信', rawResponse: '' }; } }) };
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText, turnId: `turn-${++sequence}`,
    shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  return { turn, readings: () => readings, renders: () => renders };
}
const key = (records: { occurrenceDate: string; subject: string; minutes: number }[] | undefined) =>
  (records ?? []).map(record => `${record.occurrenceDate} ${record.subject} ${record.minutes}`);

describe('scripted readings of the study-record E2E', () => {
  it('S1 actual_week: six records, 395 minutes, Thursday absent; one reading, no renderer call', async () => {
    const h = harness(['actual_week']);
    const result = await h.turn('先週の勉強を記録したいです。');
    expect(result.outcome).toBe('applied');
    expect(key(result.actualRecords)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 45', '2026-10-28 現代文 30',
      '2026-10-30 英語 50', '2026-10-31 数学 120', '2026-11-01 化学 90']);
    expect(sumActualRecordMinutes(result.actualRecords!)).toBe(395);
    expect([h.readings(), h.renders()]).toEqual([1, 0]);
  });

  it('S2: the five scripted turns end with six records, Tuesday once at 50, total 400, and the call counts the spec answers', async () => {
    const kinds = ['actual_mon', 'actual_tue_wed', 'actual_thu_rest', 'actual_fri_sun', 'actual_tue_fix'];
    const h = harness(kinds);
    const calls: Array<[number, number]> = [];
    let last;
    for (const text of ['月曜は数学60分。', '火曜英語45、水曜現代文30。', '木曜は休みでした。', '金土日。', 'あ、火曜は50分でした。']) {
      last = await h.turn(text); calls.push([h.readings(), h.renders()]);
    }
    expect(key(last!.actualRecords)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 50', '2026-10-28 現代文 30',
      '2026-10-30 英語 50', '2026-10-31 数学 120', '2026-11-01 化学 90']);
    expect(sumActualRecordMinutes(last!.actualRecords!)).toBe(400);
    // Cumulative [readings, renderer calls] after each turn: every records turn and the rest-day turn are the application's own text.
    const perTurn = calls.map(([readings, renders], index) => [readings - (calls[index - 1]?.[0] ?? 0), renders - (calls[index - 1]?.[1] ?? 0)]);
    expect(perTurn.map(([readings]) => readings)).toEqual([1, 1, 1, 1, 1]);
    kinds.forEach((kind, index) => {
      if (RECORD_ONLY_KINDS.includes(kind)) expect(perTurn[index][1], `${kind} must not call the renderer`).toBe(0);
      else expect(perTurn[index][1], `${kind} must call the renderer once`).toBe(1);
    });
  });

  it('N1 actual_thu_rest alone: no record, only the owner\'s rest sentence; one reading and no renderer call', async () => {
    const h = harness(['actual_thu_rest']);
    const result = await h.turn('木曜は休みでした。勉強していません。');
    expect(key(result.actualRecords)).toEqual([]);
    expect(result.reply).toBe(formatRestDaysReply(['2026-10-29']));
    expect([h.readings(), h.renders()]).toEqual([1, 0]);
  });

  it('N2 plan sentence: a plan reading; no study record, one reading and one renderer call', async () => {
    const h = harness(['plan']);
    const result = await h.turn('明日に数学の計画を60分入れてください。');
    expect(key(result.actualRecords)).toEqual([]);
    expect([h.readings(), h.renders()]).toEqual([1, 1]);
  });

  it.each([
    ['actual_vague_math', '数学は何分くらい勉強しましたか？'],
    ['actual_vague_weekend', '土日の化学は、日ごとに何分ずつでしたか？'],
  ])('N4 %s: no record, exactly one question, no renderer call', async (kind, question) => {
    const h = harness([kind]);
    const result = await h.turn('曖昧な発話');
    expect(key(result.actualRecords)).toEqual([]);
    expect(result.reply).toContain(question);
    expect(result.reply.match(/？/gu)).toHaveLength(1);
    expect([h.readings(), h.renders()]).toEqual([1, 0]);
  });
});
