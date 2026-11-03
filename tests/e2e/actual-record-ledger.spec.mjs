import { expect, test } from '@playwright/test';
import {
  CORRECTED_TUESDAY, REST_DAY, WEEK, WEEK_TOTAL, actualRecords, addedBy, noClockTimes, noneSaved, nothingOn, pendingReply,
  questionMarksIn, rowText, savedExactly, savedWordsIn, sumMinutes, totalText,
} from './support/actual-record-ledger.mjs';

// Controls for the oracle of the real-model examinee gate (#973 R1): it must accept the right saved week and fail on each
// defect it exists to catch. The documents are shaped like the Firestore REST documents of `actuals` that the confirmation's
// save writes (userId, occurrenceDate, actualDurationMinutes, subject, ...; no clock time, no plan link).
const OWNER = 'exam-owner';
const doc = (record, { owner = OWNER, extra = {}, id = `wp-actual-c1-${record.date}-${record.subject}` } = {}) => ({
  name: `projects/p/databases/(default)/documents/actuals/${id}`,
  fields: { id: { stringValue: id }, userId: { stringValue: owner }, planId: { nullValue: null }, occurrenceDate: { stringValue: record.date },
    actualDurationMinutes: { integerValue: String(record.minutes) }, title: { stringValue: record.subject }, subject: { stringValue: record.subject },
    isAlignedToPlan: { booleanValue: false }, note: { stringValue: '' }, updatedAt: { stringValue: '2026-11-03T01:00:00.000Z' }, ...extra },
});
const week = () => WEEK.map((record) => doc(record));
const saved = (documents, known = new Set()) => addedBy(documents, OWNER, known);

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

  // Only this account's new documents count: another user's, and the ones that existed before, are not the scenario's.
  expect(saved([...week(), doc(WEEK[1], { owner: 'someone-else', id: 'other' })])).toHaveLength(6);
  expect(saved(week(), new Set(actualRecords(week()).map((record) => record.id)))).toEqual([]);
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
});
