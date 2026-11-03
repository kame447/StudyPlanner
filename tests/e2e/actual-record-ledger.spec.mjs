import { expect, test } from '@playwright/test';
import {
  examWeekOf, todayInJapan, CORRECTED_TUESDAY, REST_DAY, WEEK, WEEK_TOTAL, actualRecords, noClockTimes, noneSaved, nothingOn, pendingReply,
  questionMarksIn, rowText, savedExactly, savedReply, savedWordsIn, studyRecordsOf, sumMinutes, totalText,
} from './support/actual-record-ledger.mjs';

// Controls for the oracle of the real-model examinee gate (#973 R1): it must accept the right saved week and fail on each
// defect it exists to catch. The documents are shaped like the Firestore REST documents of `actuals` that the confirmation's
// save writes (userId, occurrenceDate, actualDurationMinutes, subject, ...; no clock time, no plan link).
const OWNER = 'exam-owner';
const doc = (record, { owner = OWNER, extra = {}, id = `wp-actual-${owner}-${record.date}-${record.subject}` } = {}) => ({
  name: `projects/p/databases/(default)/documents/actuals/${id}`,
  fields: { id: { stringValue: id }, userId: { stringValue: owner }, planId: { nullValue: null }, occurrenceDate: { stringValue: record.date },
    actualDurationMinutes: { integerValue: String(record.minutes) }, title: { stringValue: record.subject }, subject: { stringValue: record.subject },
    isAlignedToPlan: { booleanValue: false }, note: { stringValue: '' }, updatedAt: { stringValue: '2026-11-03T01:00:00.000Z' }, ...extra },
});
const week = () => WEEK.map((record) => doc(record));
const saved = (documents) => studyRecordsOf(documents, OWNER);

test('the oracle accepts the right saved week and fails each defect it exists to catch', () => {
  expect(sumMinutes(WEEK)).toBe(WEEK_TOTAL);
  expect(savedExactly(saved(week()), WEEK)).toEqual([]);
  expect(noClockTimes(saved(week()))).toEqual([]);
  expect(nothingOn(saved(week()), REST_DAY)).toEqual([]);
  expect(noneSaved(saved(week()))).toHaveLength(1);
  expect(noneSaved([])).toEqual([]);

  // A double count of the corrected Tuesday (45 and 50 both saved), a missing day, wrong minutes, an invented Thursday, an extra day.
  const doubled = [...week(), doc(CORRECTED_TUESDAY, { id: 'wp-actual-c2-tue' })];
  expect(savedExactly(saved(doubled), WEEK.map((r) => (r.date === CORRECTED_TUESDAY.date ? CORRECTED_TUESDAY : r)))).toHaveLength(1);
  expect(savedExactly(saved(week().slice(1)), WEEK)).toEqual(['2026-10-26 数学: expected exactly 1 document, found 0']);
  expect(savedExactly(saved([doc({ ...WEEK[0], minutes: 30 }), ...week().slice(1)]), WEEK)).toEqual(['2026-10-26 数学: expected 60 minutes, found 30']);
  const thursday = doc({ date: REST_DAY, subject: '数学', minutes: 30 });
  expect(nothingOn(saved([...week(), thursday]), REST_DAY)).toHaveLength(1);
  expect(savedExactly(saved([...week(), thursday]), WEEK)).toEqual(['unexpected document 2026-10-29 数学 30']);

  // A clock time or a plan link on a study record is a fake: it fails.
  const withTime = doc(WEEK[0], { extra: { actualStartTime: { stringValue: '19:00' }, actualEndTime: { stringValue: '20:00' } } });
  expect(noClockTimes(saved([withTime]))).toHaveLength(1);
  expect(noClockTimes(saved([doc(WEEK[0], { extra: { planId: { stringValue: 'plan-1' } } })]))).toHaveLength(1);

  // Only this account's study-record documents count: another user's, and any other actual of the account, are not the scenario's.
  expect(saved([...week(), doc(WEEK[1], { owner: 'someone-else' })])).toHaveLength(6);
  expect(saved([...week(), doc(WEEK[1], { id: 'timed-or-plain-actual' })])).toHaveLength(6);
  expect(actualRecords(week())[0].id).toBe('wp-actual-exam-owner-2026-10-26-数学');
});

test('the reply checks: pending wording is exact, "saved" words are found, questions are counted', () => {
  expect(totalText(395)).toBe('6時間35分（395分）');
  expect(totalText(400)).toBe('6時間40分（400分）');
  expect(totalText(45)).toBe('45分');
  expect(rowText(WEEK[0])).toBe('月 10/26 数学 60分（1時間）');
  expect(rowText(WEEK[5])).toBe('日 11/1 化学 90分（1時間30分）');
  const reply = pendingReply(WEEK, WEEK);
  expect(reply).toBe('確認用に整理しました（まだ保存していません）：月 10/26 数学 60分（1時間）、火 10/27 英語 45分、水 10/28 現代文 30分、'
    + '金 10/30 英語 50分、土 10/31 数学 120分（2時間）、日 11/1 化学 90分（1時間30分）。ここまでの合計は6時間35分（395分）です。'
    + 'ほかの日があれば続けて教えてください。そろったら、確認画面の「この内容で実績を保存」を押すと保存されます。');
  expect(savedWordsIn(reply)).toEqual([]);
  for (const word of ['記録しました', '保存しました', '保存済み']) expect(savedWordsIn(`はい、${word}。`)).toEqual([word]);
  expect(questionMarksIn('数学は何分くらい勉強しましたか？')).toBe(1);
  expect(questionMarksIn('何分でしたか？いつですか？')).toBe(2);
  expect(questionMarksIn(reply)).toBe(0);
  // After a save and a reload the same sentence is answered as saved, with that one sentence and never as "not saved yet".
  const alreadySaved = savedReply(WEEK);
  expect(alreadySaved).toBe('その内容はすでに保存されています：月 10/26 数学 60分（1時間）、火 10/27 英語 45分、水 10/28 現代文 30分、'
    + '金 10/30 英語 50分、土 10/31 数学 120分（2時間）、日 11/1 化学 90分（1時間30分）。');
  expect(alreadySaved).not.toContain('まだ保存していません');
  expect(savedWordsIn(alreadySaved)).toEqual([]);
});

test('last week follows the real clock: the Monday..Sunday before this run\'s week, with the same scenario', () => {
  const span = (today) => { const { week, restDay } = examWeekOf(today); return [week[0].date, restDay, week[5].date]; };
  expect(span('2026-11-02')).toEqual(['2026-10-26', '2026-10-29', '2026-11-01']); // Monday
  expect(span('2026-11-03')).toEqual(['2026-10-26', '2026-10-29', '2026-11-01']); // Tuesday
  expect(span('2026-11-08')).toEqual(['2026-10-26', '2026-10-29', '2026-11-01']); // Sunday
  expect(span('2026-11-11')).toEqual(['2026-11-02', '2026-11-05', '2026-11-08']); // Wednesday of the next week
  expect(span('2027-01-05')).toEqual(['2026-12-28', '2026-12-31', '2027-01-03']); // across the year end
  const { week, correctedTuesday, total, correctedTotal } = examWeekOf('2026-11-11');
  expect(sumMinutes(week)).toBe(total);
  expect(correctedTuesday).toEqual({ date: week[1].date, subject: '英語', minutes: 50 });
  expect(correctedTotal).toBe(total + 5);
  expect(rowText(week[0])).toBe('月 11/2 数学 60分（1時間）');
  // 2026-11-03 10:00 JST is still 2026-11-03 in Japan; 2026-11-02 23:30 UTC is already the 3rd there.
  expect(todayInJapan(Date.parse('2026-11-03T01:00:00Z'))).toBe('2026-11-03');
  expect(todayInJapan(Date.parse('2026-11-02T23:30:00Z'))).toBe('2026-11-03');
});
