// #973 I2: what the user says they actually studied becomes date × subject × minutes records, apart from
// the plan. The provider is the real interpreter reading scripted typed output (no model call), so the
// strict schema decoder, the dry-run validation and the session all run. The expected values come from the
// fixed scenarios (ARGON-FIRST: week 2026-10-26..11-01, 月数学60 火英語45 水現代文30 木休み 金英語50 土数学120 日化学90 = 395)
// and are not taken from any output.
import { describe, expect, it } from 'vitest';
import { createMemoryStorageHarness } from '../../testUtils/weeklyPlanningApplicationTestHarness';
import { createWeeklyPlanningVNextProviderInterpreter } from '../semantic/weeklyPlanningVNextProvider';
import { createWeeklyPlanningVNextLocalSession } from './weeklyPlanningVNextLocalSession';
import { markWeeklyPlanningVNextActualRecordsSaved, submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts, type WeeklyPlanningVNextExperimentalScope } from './weeklyPlanningVNextExperimentalSession';
import { formatVNextActualDay, formatVNextActualMinutes, totalVNextActualMinutes } from '../weeklyPlanningVNextStudyRecords';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';

const OWNER = 'synthetic-actual-owner'; const WEEK = '2026-11-02'; const TODAY = '2026-11-03';
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK, conversationId: 'actual-conversation',
  notBeforeTime: '09:00', clock: { currentDate: TODAY, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } };
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (studyRecords: unknown[] = [], studyRecordQuestion: unknown = null, delta: Record<string, unknown> = {}) =>
  ({ planningIntent: 'discuss', conversationActs: [], delta: { ...EMPTY, ...delta }, studyRecords, studyRecordQuestion, answer: null });
const rec = (dateExpression: string, subject: string, minutes: number) => ({ dateExpression, subject, minutes });
const MON = rec('2026-10-26', '数学', 60), TUE = rec('2026-10-27', '英語', 45), WED = rec('2026-10-28', '現代文', 30),
  FRI = rec('2026-10-30', '英語', 50), SAT = rec('2026-10-31', '数学', 120), SUN = rec('2026-11-01', '化学', 90);

function harness(responses: unknown[]) {
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId: OWNER, weekStartDate: WEEK, storage: memory.storage });
  const contexts: Array<Record<string, unknown>> = [];
  const saves: unknown[] = [];
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion(input) {
      if (!responses.length) throw new Error('synthetic script exhausted');
      contexts.push(JSON.parse(input.messages[1].content)); return JSON.stringify(responses.shift());
    } }, approvalLedger: { read: () => null, write: () => undefined },
    plans: { findExistingPlanId: async () => undefined, async saveBlock(block) { saves.push(block); return { planId: `plan:${block.id}` }; } },
    calendar: () => ({ plans: [], actuals: [], monthEvents: [], scheduleTemplates: [] }), now: () => `${TODAY}T00:00:00.000Z`,
    createRenderer: () => ({ async render() { return { status: 'rendered', text: '合成の返信', rawResponse: '' }; } }) };
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, userText, turnId: `turn-${++sequence}`,
    shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  const stored = () => local.readCheckpoint()!.vnext;
  return { turn, stored, ports, local, contexts, saves };
}
const key = (records: { occurrenceDate: string; subject: string; minutes: number }[]) =>
  records.map(record => `${record.occurrenceDate} ${record.subject} ${record.minutes}`);

describe('VNext study records (#973 I2)', () => {
  it('S1: a long utterance becomes six records, total 395 minutes, saves nothing and creates no plan', async () => {
    const h = harness([reading([MON, TUE, WED, FRI, SAT, SUN])]);
    const result = await h.turn('先週は月曜に数学を60分、火曜に英語45分、水曜に現代文30分、金曜に英語50分、土曜に数学120分、日曜に化学90分やりました。木曜は休みです。');
    expect(result.outcome).toBe('applied');
    expect(key(result.actualRecords!)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 45', '2026-10-28 現代文 30',
      '2026-10-30 英語 50', '2026-10-31 数学 120', '2026-11-01 化学 90']);
    expect(totalVNextActualMinutes(result.actualRecords!)).toBe(395);
    expect(result.reply).toContain('395分（6時間35分）');
    expect(result.reply).toContain('確認画面で保存できます');
    expect(result.reply).not.toMatch(/\d{1,2}:\d{2}/u);
    expect(result.actualRecords!.every(record => record.status === 'pending')).toBe(true);
    // No fabricated clock time: a record is exactly a date, a subject and minutes.
    expect(result.actualRecords!.map(record => Object.keys(record).sort())).toEqual(Array(6).fill(['id', 'minutes', 'occurrenceDate', 'status', 'subject']));
    expect(h.stored().actualRecords).toEqual(result.actualRecords);
    expect(result.preview).toBeNull();
    expect(result.graphRevision).toBe(0);
    expect(h.saves).toEqual([]);
  });

  it('S2: short turns accumulate; a Tuesday correction replaces (45→50), never adds; the rest day makes no record', async () => {
    const h = harness([reading([MON]), reading([TUE, WED]), reading(), reading([FRI, SAT, SUN]), reading([rec('2026-10-27', '英語', 50)])]);
    await h.turn('月曜は数学を60分やりました。');
    await h.turn('火曜は英語45分、水曜は現代文30分。');
    const rest = await h.turn('木曜は休みでした。');
    expect(key(rest.actualRecords!)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 45', '2026-10-28 現代文 30']);
    const weekend = await h.turn('金曜は英語50分、土曜は数学2時間、日曜は化学90分でした。');
    expect(totalVNextActualMinutes(weekend.actualRecords!)).toBe(395);
    const corrected = await h.turn('あ、火曜は50分だった。');
    expect(key(corrected.actualRecords!)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 50', '2026-10-28 現代文 30',
      '2026-10-30 英語 50', '2026-10-31 数学 120', '2026-11-01 化学 90']);
    expect(corrected.actualRecords!.filter(record => record.occurrenceDate === '2026-10-27')).toHaveLength(1);
    expect(totalVNextActualMinutes(corrected.actualRecords!)).toBe(400);
    expect(corrected.reply).toContain('400分（6時間40分）');
    expect(h.stored().actualRecords!.some(record => record.occurrenceDate === '2026-10-29')).toBe(false);
  });

  it('N1: restating the same day and minutes changes nothing; 0 minutes removes that record', async () => {
    const h = harness([reading([MON]), reading([MON]), reading([rec('2026-10-26', '数学', 0)])]);
    await h.turn('月曜は数学60分。');
    const again = await h.turn('月曜は数学60分でした。');
    expect(again.outcome).toBe('noop');
    expect(again.actualRecords).toHaveLength(1);
    const removed = await h.turn('やっぱり月曜は数学をやっていません。');
    expect(removed.actualRecords).toEqual([]);
    expect(h.stored().actualRecords).toBeUndefined();
  });

  it('N2: a plan sentence leaves the records untouched and creates no record', async () => {
    const plan: VNextAddFact[] = [{ kind: 'task', localId: 'math', category: 'study', title: '数学' },
      { kind: 'workload', localId: 'w', taskRef: { localId: 'math' }, componentRef: null, quantityRole: 'target', amount: 60, unitCode: 'minute',
        unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
    const h = harness([reading([MON]), reading([], null, { add: plan })]);
    await h.turn('月曜は数学を60分やりました。');
    const planned = await h.turn('来週の数学の計画を60分入れて。');
    expect(key(planned.actualRecords!)).toEqual(['2026-10-26 数学 60']);
    expect(planned.reply).toBe('合成の返信');
    expect(h.stored().state.graph.workloads).toHaveLength(1);
  });

  it('N4: vague minutes or a total over several days record nothing and ask exactly one question; the answer completes it', async () => {
    const h = harness([reading([], { reason: 'missing_minutes', label: '数学' }), reading([rec('2026-10-27', '数学', 30)]),
      reading([], { reason: 'split_needed', label: '土日の化学' })]);
    const vague = await h.turn('火曜は数学ちょっとやった。');
    expect(vague.actualRecords).toEqual([]);
    expect(vague.reply).toBe('数学は何分くらい勉強しましたか？');
    expect(vague.reply.match(/？/gu)).toHaveLength(1);
    expect(h.stored().pendingStudyRecordQuestion).toEqual({ reason: 'missing_minutes', label: '数学' });
    const answered = await h.turn('30分くらい。');
    expect(h.contexts[1].pendingStudyRecordQuestion).toEqual({ reason: 'missing_minutes', label: '数学' });
    expect(key(answered.actualRecords!)).toEqual(['2026-10-27 数学 30']);
    expect(h.stored().pendingStudyRecordQuestion).toBeUndefined();
    const split = await h.turn('土日で化学3時間やった。');
    expect(key(split.actualRecords!)).toEqual(['2026-10-27 数学 30']);
    expect(split.reply).toContain('土日の化学は、日ごとに何分ずつでしたか？');
  });

  it('a future date is not something already done: the reading is rejected, repaired once, and nothing is recorded', async () => {
    const future = reading([rec('2026-11-10', '数学', 60)]);
    const h = harness([future, future]);
    const result = await h.turn('来週の月曜に数学60分やりました。');
    expect(result.outcome).toBe('interpretation_failed');
    expect(result.interpretation).toMatchObject({ status: 'failed', reason: 'rejected_after_repair' });
    expect(h.stored().actualRecords).toBeUndefined();
  });

  it('saved status: marking changes only the status; a same-minutes restatement stays saved, a changed one is pending again', async () => {
    const h = harness([reading([MON, TUE]), reading([MON]), reading([rec('2026-10-26', '数学', 75)])]);
    const first = await h.turn('月曜は数学60分、火曜は英語45分。');
    const marked = markWeeklyPlanningVNextActualRecordsSaved(scope, h.ports, [first.actualRecords![0].id]);
    expect(marked.status).toBe('marked');
    expect(h.stored().actualRecords!.map(record => `${record.subject}:${record.minutes}:${record.status}`)).toEqual(['数学:60:saved', '英語:45:pending']);
    expect(markWeeklyPlanningVNextActualRecordsSaved(scope, h.ports, [first.actualRecords![0].id]).status).toBe('unchanged');
    await h.turn('月曜は数学60分でした。');
    expect(h.stored().actualRecords![0].status).toBe('saved');
    await h.turn('月曜の数学は75分でした。');
    expect(h.stored().actualRecords!.map(record => `${record.minutes}:${record.status}`)).toEqual(['75:pending', '45:pending']);
  });

  it('the pure formats: 395 → 395分（6時間35分）, 45 → 45分, and the day label', () => {
    expect(formatVNextActualMinutes(395)).toBe('395分（6時間35分）');
    expect(formatVNextActualMinutes(120)).toBe('120分（2時間）');
    expect(formatVNextActualMinutes(45)).toBe('45分');
    expect(formatVNextActualDay('2026-10-26')).toBe('月 10/26');
  });
});
