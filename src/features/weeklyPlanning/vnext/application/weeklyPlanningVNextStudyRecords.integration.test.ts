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
import { formatRestDaysReply, formatActualRecordMinutes, formatActualRecordRow, formatActualRecordsTotal, formatAlreadySavedActualRecordsReply, selectPendingActualRecords, sumActualRecordMinutes } from '../../application/weeklyPlanningActualRecords';
import { savedStudyRecordMinutes, vnextActualRecordId, VNEXT_STUDY_RECORD_PENDING_PREFIX, VNEXT_STUDY_RECORD_REMOVED, VNEXT_STUDY_RECORD_SAVE_GUIDE, VNEXT_STUDY_RECORD_CONFIRMATION_GUIDE, VNEXT_STUDY_RECORD_UNCHANGED } from '../weeklyPlanningVNextStudyRecords';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';

const OWNER = 'synthetic-actual-owner'; const WEEK = '2026-11-02'; const TODAY = '2026-11-03';
const scope: WeeklyPlanningVNextExperimentalScope = { ownerId: OWNER, weekStartDate: WEEK, conversationId: 'actual-conversation',
  notBeforeTime: '09:00', clock: { currentDate: TODAY, weekStartsOn: 'monday', timeZone: 'Asia/Tokyo', planningStartDate: WEEK, planningEndDate: '2026-11-08' } };
const EMPTY = { add: [], patch: [], remove: [], relate: [], defer: [] };
const reading = (studyRecords: unknown[] = [], studyRecordQuestion: unknown = null, delta: Record<string, unknown> = {}, studyRestDays: string[] = []) =>
  ({ planningIntent: 'discuss', conversationActs: [], delta: { ...EMPTY, ...delta }, studyRecords, studyRecordQuestion, studyRestDays, answer: null });
const rec = (dateExpression: string, subject: string, minutes: number) => ({ dateExpression, subject, minutes });
const MON = rec('2026-10-26', '数学', 60), TUE = rec('2026-10-27', '英語', 45), WED = rec('2026-10-28', '現代文', 30),
  FRI = rec('2026-10-30', '英語', 50), SAT = rec('2026-10-31', '数学', 120), SUN = rec('2026-11-01', '化学', 90);

function harness(responses: unknown[], conversationId = scope.conversationId, ownerId = OWNER, savedActuals: unknown[] = []) {
  const chatScope = { ...scope, conversationId, ownerId };
  const memory = createMemoryStorageHarness();
  const local = createWeeklyPlanningVNextLocalSession({ ownerId, weekStartDate: WEEK, storage: memory.storage });
  const contexts: Array<Record<string, unknown>> = [];
  const saves: unknown[] = [];
  let renders = 0;
  const ports: WeeklyPlanningVNextExperimentalPorts = { checkpoint: local.checkpoint, legacyV5Checkpoint: { read: () => null },
    interpret: createWeeklyPlanningVNextProviderInterpreter(), client: { async createChatCompletion(input) {
      if (!responses.length) throw new Error('synthetic script exhausted');
      contexts.push(JSON.parse(input.messages[1].content)); return JSON.stringify(responses.shift());
    } }, approvalLedger: { read: () => null, write: () => undefined },
    plans: { findExistingPlanId: async () => undefined, async saveBlock(block) { saves.push(block); return { planId: `plan:${block.id}` }; } },
    calendar: () => ({ plans: [], actuals: savedActuals as never[], monthEvents: [], scheduleTemplates: [] }), now: () => `${TODAY}T00:00:00.000Z`,
    createRenderer: () => ({ async render() { renders++; return { status: 'rendered', text: '合成の返信', rawResponse: '' }; } }) };
  let sequence = 0;
  const turn = (userText: string) => submitWeeklyPlanningVNextExperimentalTurn({ scope: chatScope, ports, userText, turnId: `turn-${++sequence}`,
    shownRevision: local.readCheckpoint()?.vnext.presentedQuestion?.graphRevision ?? null });
  const stored = () => local.readCheckpoint()!.vnext;
  return { turn, stored, ports, local, contexts, saves, renders: () => renders };
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
    expect(sumActualRecordMinutes(result.actualRecords!)).toBe(395);
    // Exact reply, built from the owner's format functions: an unsaved confirmation list, never "recorded".
    expect(result.reply).toBe(`${VNEXT_STUDY_RECORD_PENDING_PREFIX}${result.actualRecords!.map(formatActualRecordRow).join('、')}。`
      + `ここまでの合計は${formatActualRecordsTotal(395)}です。${VNEXT_STUDY_RECORD_CONFIRMATION_GUIDE}`);
    expect(formatActualRecordsTotal(395)).toBe('6時間35分（395分）');
    expect(result.actualRecords!.every(record => record.status === 'pending')).toBe(true);
    // No fabricated clock time: a record is exactly a date, a subject and minutes.
    expect(result.actualRecords!.map(record => Object.keys(record).sort())).toEqual(Array(6).fill(['id', 'minutes', 'occurrenceDate', 'status', 'subject']));
    expect(h.stored().actualRecords).toEqual(result.actualRecords);
    expect(result.preview).toBeNull();
    expect(result.graphRevision).toBe(0);
    expect(h.saves).toEqual([]);
  });

  it('the record id is owner × date × subject, so the same day and subject is the same id in another chat, after a reload, and in a resend', async () => {
    const first = await harness([reading([MON])], 'conversation-A').turn('月曜は数学を60分やりました。');
    const otherChat = await harness([reading([MON])], 'conversation-B').turn('月曜は数学を60分やりました。');
    expect(first.actualRecords![0].id).toBe(`wp-actual-${OWNER}-2026-10-26-数学`);
    expect(otherChat.actualRecords![0].id).toBe(first.actualRecords![0].id);
    // Spacing and width of the subject do not make another record; another owner never shares an id.
    const wide = await harness([reading([rec('2026-10-26', '　数学 ', 60)])]).turn('月曜は数学を60分やりました。');
    expect(wide.actualRecords![0].id).toBe(first.actualRecords![0].id);
    const another = await harness([reading([MON])], 'conversation-A', 'another-owner').turn('月曜は数学を60分やりました。');
    expect(another.actualRecords![0].id).toBe('wp-actual-another-owner-2026-10-26-数学');
    // One chat, reloaded from its checkpoint, then the same sentence again: still one record with the same id.
    const h = harness([reading([MON]), reading([MON])]);
    const once = await h.turn('月曜は数学を60分やりました。');
    const again = await h.turn('月曜は数学を60分やりました。');
    expect(again.outcome).toBe('noop');
    expect(again.actualRecords!.map(record => record.id)).toEqual(once.actualRecords!.map(record => record.id));
  });

  it('S2: short turns accumulate; a Tuesday correction replaces (45→50), never adds; the rest day makes no record', async () => {
    const h = harness([reading([MON]), reading([TUE, WED]), reading(), reading([FRI, SAT, SUN]), reading([rec('2026-10-27', '英語', 50)])]);
    await h.turn('月曜は数学を60分やりました。');
    await h.turn('火曜は英語45分、水曜は現代文30分。');
    const rest = await h.turn('木曜は休みでした。');
    expect(key(rest.actualRecords!)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 45', '2026-10-28 現代文 30']);
    const weekend = await h.turn('金曜は英語50分、土曜は数学2時間、日曜は化学90分でした。');
    expect(sumActualRecordMinutes(weekend.actualRecords!)).toBe(395);
    const corrected = await h.turn('あ、火曜は50分だった。');
    expect(key(corrected.actualRecords!)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 50', '2026-10-28 現代文 30',
      '2026-10-30 英語 50', '2026-10-31 数学 120', '2026-11-01 化学 90']);
    expect(corrected.actualRecords!.filter(record => record.occurrenceDate === '2026-10-27')).toHaveLength(1);
    expect(sumActualRecordMinutes(corrected.actualRecords!)).toBe(400);
    expect(corrected.reply).toBe(`${VNEXT_STUDY_RECORD_PENDING_PREFIX}${formatActualRecordRow({ ...corrected.actualRecords![1], previousMinutes: 45 })}。`
      + `ここまでの合計は${formatActualRecordsTotal(400)}です。${VNEXT_STUDY_RECORD_CONFIRMATION_GUIDE}`);
    expect(formatActualRecordsTotal(400)).toBe('6時間40分（400分）');
    expect(h.stored().actualRecords!.some(record => record.occurrenceDate === '2026-10-29')).toBe(false);
  });

  it('N1: restating the same day and minutes changes nothing; 0 minutes removes that record', async () => {
    const h = harness([reading([MON]), reading([MON]), reading([rec('2026-10-26', '数学', 0)])]);
    await h.turn('月曜は数学60分。');
    const again = await h.turn('月曜は数学60分でした。');
    expect(again.outcome).toBe('noop');
    expect(again.reply).toBe(`${VNEXT_STUDY_RECORD_UNCHANGED}ここまでの合計は${formatActualRecordsTotal(60)}です。${VNEXT_STUDY_RECORD_SAVE_GUIDE}`);
    expect(again.actualRecords).toHaveLength(1);
    const removed = await h.turn('やっぱり月曜は数学をやっていません。');
    expect(removed.actualRecords).toEqual([]);
    expect(removed.reply).toBe(VNEXT_STUDY_RECORD_REMOVED);
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
    expect(split.reply).toBe(`ここまでの合計は${formatActualRecordsTotal(30)}です。土日の化学は、日ごとに何分ずつでしたか？`);
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

  // What a reload leaves: a new chat with an empty checkpoint, while the planner has loaded the actuals saved earlier.
  const savedDoc = (record: { dateExpression: string; subject: string; minutes: number }, owner = OWNER) => ({
    id: vnextActualRecordId(owner, record.dateExpression, record.subject), userId: owner, planId: null, occurrenceDate: record.dateExpression,
    actualDurationMinutes: record.minutes, subject: record.subject, title: record.subject });
  const savedWeek = [MON, TUE, WED, FRI, SAT, SUN];

  it('fix-03: the same week resent in a new chat after it was saved is already saved: status saved, nothing to confirm, and it says so', async () => {
    const h = harness([reading(savedWeek)], 'conversation-after-reload', OWNER, savedWeek.map(record => savedDoc(record)));
    const result = await h.turn('先週の分です。月曜は数学60分、火曜は英語45分、水曜は現代文30分、金曜は英語50分、土曜は数学2時間、日曜は化学90分。');
    expect(result.actualRecords!.every(record => record.status === 'saved')).toBe(true);
    expect(key(result.actualRecords!)).toHaveLength(6);
    expect(selectPendingActualRecords(result.actualRecords)).toEqual([]);
    expect(result.reply).toBe(formatAlreadySavedActualRecordsReply(result.actualRecords!));
    expect(result.reply).not.toContain('まだ保存していません');
    expect(h.stored().actualRecords!.every(record => record.status === 'saved')).toBe(true);
    expect(h.saves).toEqual([]);
  });

  it('fix-03: with other minutes only that record awaits confirmation; the reply says both, separately', async () => {
    const h = harness([reading([MON, rec('2026-10-27', '英語', 50), WED])], 'conversation-after-reload', OWNER, savedWeek.map(record => savedDoc(record)));
    const result = await h.turn('月曜は数学60分、火曜は英語50分、水曜は現代文30分。');
    const byDay = Object.fromEntries(result.actualRecords!.map(record => [record.occurrenceDate, `${record.minutes}:${record.status}`]));
    expect(byDay).toEqual({ '2026-10-26': '60:saved', '2026-10-27': '50:pending', '2026-10-28': '30:saved' });
    expect(selectPendingActualRecords(result.actualRecords).map(record => record.id)).toEqual([vnextActualRecordId(OWNER, '2026-10-27', '英語')]);
    const [monday, tuesday, wednesday] = result.actualRecords!;
    expect(result.reply).toBe(`${formatAlreadySavedActualRecordsReply([monday, wednesday])}${VNEXT_STUDY_RECORD_PENDING_PREFIX}${formatActualRecordRow(tuesday)}。`
      + `ここまでの合計は${formatActualRecordsTotal(140)}です。${VNEXT_STUDY_RECORD_CONFIRMATION_GUIDE}`);
  });

  it('fix-03: only this owner\'s saved study records count (other owners, timed actuals and ids outside the owner prefix do not)', () => {
    const mine = savedDoc(MON);
    expect(savedStudyRecordMinutes([mine, savedDoc(TUE, 'someone-else'), { id: 'plain-actual', userId: OWNER, actualDurationMinutes: 30 },
      { id: vnextActualRecordId(OWNER, '2026-10-28', '現代文'), userId: OWNER }, { ...savedDoc(WED), userId: 'someone-else' }], OWNER))
      .toEqual(new Map([[mine.id, 60]]));
  });

  // fix-04: a rest day is taken plainly (no advice, no suggestion, no question) and never falls into the planning invitation.
  const THU = '2026-10-29';
  it('fix-04: a rest day alone is answered with one flat sentence, no renderer, no question, and the list is as it was', async () => {
    const h = harness([reading([MON, TUE, WED]), reading([], null, {}, [THU])]);
    await h.turn('月曜は数学60分、火曜は英語45分、水曜は現代文30分。');
    const rendersBefore = h.renders();
    const rest = await h.turn('木曜は休みでした。');
    expect(h.renders()).toBe(rendersBefore);
    expect(key(rest.actualRecords!)).toEqual(['2026-10-26 数学 60', '2026-10-27 英語 45', '2026-10-28 現代文 30']);
    expect(rest.reply).toBe(`${formatRestDaysReply([THU])}ここまでの合計は${formatActualRecordsTotal(135)}です。${VNEXT_STUDY_RECORD_SAVE_GUIDE}`);
    expect(formatRestDaysReply([THU])).toBe('10/29（木）はお休みですね。');
    expect(rest.reply).not.toMatch(/[？?]/u);
    expect(rest.question).toBeNull();
    expect(rest.preview).toBeNull();
    expect(h.saves).toEqual([]);
  });

  it('fix-04: with nothing waiting the reply is only that sentence; the checkpoint keeps no records', async () => {
    const h = harness([reading([], null, {}, [THU])]);
    const rest = await h.turn('木曜は休みでした。');
    expect(rest.reply).toBe('10/29（木）はお休みですね。');
    expect(rest.actualRecords).toEqual([]);
    expect(h.renders()).toBe(0);
    expect(h.stored().actualRecords).toBeUndefined();
  });

  it('fix-04: a rest day takes that day\'s unsaved records off the list; a saved record is never touched', async () => {
    const h = harness([reading([MON, TUE, WED]), reading([], null, {}, ['2026-10-27', '2026-10-28'])], 'conversation-rest', OWNER, [savedDoc(TUE)]);
    const first = await h.turn('月曜は数学60分、火曜は英語45分、水曜は現代文30分。');
    expect(first.actualRecords!.map(record => `${record.occurrenceDate}:${record.status}`)).toEqual(['2026-10-26:pending', '2026-10-27:saved', '2026-10-28:pending']);
    const rest = await h.turn('火曜と水曜は休みでした。');
    expect(rest.actualRecords!.map(record => `${record.occurrenceDate}:${record.status}`)).toEqual(['2026-10-26:pending', '2026-10-27:saved']);
    expect(rest.reply.startsWith(formatRestDaysReply(['2026-10-27', '2026-10-28']))).toBe(true);
  });

  it('fix-04: a rest day stated together with records only takes effect (the reply is the records reply)', async () => {
    const h = harness([reading([MON], null, {}, [THU])]);
    const result = await h.turn('月曜は数学60分、木曜は休みでした。');
    expect(result.reply).toBe(`${VNEXT_STUDY_RECORD_PENDING_PREFIX}${formatActualRecordRow(result.actualRecords![0])}。ここまでの合計は${formatActualRecordsTotal(60)}です。${VNEXT_STUDY_RECORD_CONFIRMATION_GUIDE}`);
  });

  it('fix-04: a future rest day is not something that happened: rejected, repaired once, nothing changes', async () => {
    const future = reading([], null, {}, ['2026-11-10']);
    const h = harness([future, future]);
    const result = await h.turn('来週の月曜は休みです。');
    expect(result.outcome).toBe('interpretation_failed');
    expect(h.stored().actualRecords).toBeUndefined();
  });

  it('display formats come from their single owner (60分（1時間）, 6時間35分（395分）)', () => {
    expect(formatActualRecordMinutes(60)).toBe('60分（1時間）');
    expect(formatActualRecordRow({ id: 'x', occurrenceDate: '2026-10-26', subject: '数学', minutes: 60 })).toBe('月 10/26 数学 60分（1時間）');
  });
});
