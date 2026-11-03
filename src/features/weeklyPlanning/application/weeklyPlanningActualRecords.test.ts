import { describe, expect, it } from 'vitest';
import {
  formatActualRecordRow,
  formatAlreadySavedActualRecordsReply,
  formatSavingActualRecordsReply,
  resolvePendingActualRecordsAgainstSaved,
  toActualRecordsToSave,
  formatActualRecordsTotal,
  selectPendingActualRecords,
  sumActualRecordMinutes,
  type WeeklyPlanningActualRecord,
} from './weeklyPlanningActualRecords';

// The independent fixed scenario of ARGON-FIRST.md: 2026-10-26 (Mon) … 11-01 (Sun), 395 minutes in all.
const week: WeeklyPlanningActualRecord[] = [
  { id: 'a-1026-math', occurrenceDate: '2026-10-26', subject: '数学', minutes: 60 },
  { id: 'a-1027-eng', occurrenceDate: '2026-10-27', subject: '英語', minutes: 45 },
  { id: 'a-1028-jp', occurrenceDate: '2026-10-28', subject: '現代文', minutes: 30 },
  { id: 'a-1030-eng', occurrenceDate: '2026-10-30', subject: '英語', minutes: 50 },
  { id: 'a-1031-math', occurrenceDate: '2026-10-31', subject: '数学', minutes: 120 },
  { id: 'a-1101-chem', occurrenceDate: '2026-11-01', subject: '化学', minutes: 90 },
];

describe('weekly actual record confirmation wording', () => {
  it('writes one line per day with the weekday, date, subject and minutes', () => {
    const rows = selectPendingActualRecords(week).map(formatActualRecordRow);
    expect(rows).toEqual([
      '月 10/26 数学 60分（1時間）',
      '火 10/27 英語 45分',
      '水 10/28 現代文 30分',
      '金 10/30 英語 50分',
      '土 10/31 数学 120分（2時間）',
      '日 11/1 化学 90分（1時間30分）',
    ]);
  });

  it('has no row for the rest day and totals 6時間35分（395分）', () => {
    const pending = selectPendingActualRecords(week);
    expect(pending.some(record => record.occurrenceDate === '2026-10-29')).toBe(false);
    expect(formatActualRecordsTotal(sumActualRecordMinutes(pending))).toBe('6時間35分（395分）');
  });

  it('formats totals under an hour and on whole hours', () => {
    expect(formatActualRecordsTotal(45)).toBe('45分');
    expect(formatActualRecordsTotal(120)).toBe('2時間（120分）');
    expect(formatActualRecordsTotal(400)).toBe('6時間40分（400分）');
  });

  it('never offers a saved record again and drops records that could not be saved', () => {
    const records: WeeklyPlanningActualRecord[] = [
      { ...week[0], status: 'saved' },
      week[1],
      { id: 'zero', occurrenceDate: '2026-10-29', subject: '数学', minutes: 0 },
      { id: 'fraction', occurrenceDate: '2026-10-29', subject: '数学', minutes: 12.5 },
      { id: 'blank', occurrenceDate: '2026-10-29', subject: ' ', minutes: 10 },
      { id: 'huge', occurrenceDate: '2026-10-29', subject: '数学', minutes: 1440 },
    ];
    expect(selectPendingActualRecords(records).map(record => record.id)).toEqual(['a-1027-eng']);
  });

  it('carries no time of day anywhere in what it hands onward', () => {
    expect(JSON.stringify(selectPendingActualRecords(week))).not.toMatch(/Time|\d{2}:\d{2}/);
  });
  it('against what is saved: new stays, same minutes drops, different minutes becomes an announced replacement', () => {
    const pending = selectPendingActualRecords(week);
    const resolved = resolvePendingActualRecordsAgainstSaved(pending, new Map([['a-1026-math', 60], ['a-1027-eng', 30]]));
    expect(resolved.map(record => record.id)).toEqual(['a-1027-eng', 'a-1028-jp', 'a-1030-eng', 'a-1031-math', 'a-1101-chem']);
    expect(formatActualRecordRow(resolved[0])).toBe('火 10/27 英語 45分 ※保存済みの30分を置き換えます');
    expect(formatActualRecordRow(resolved[1])).toBe('水 10/28 現代文 30分');
    expect(Object.keys(toActualRecordsToSave(resolved)[0]).sort()).toEqual(['id', 'minutes', 'occurrenceDate', 'subject']);
  });
  it('words an already-saved restatement as saved, never as waiting for confirmation', () => {
    const text = formatAlreadySavedActualRecordsReply(selectPendingActualRecords(week).slice(0, 2));
    expect(text).toBe('その内容はすでに保存されています：月 10/26 数学 60分（1時間）、火 10/27 英語 45分。');
    expect(text).not.toContain('まだ保存していません');
  });
  it('words an in-flight restatement as unconfirmed', () => {
    expect(formatSavingActualRecordsReply(selectPendingActualRecords(week).slice(0, 1)))
      .toBe('保存中（まだ確定していません）：月 10/26 数学 60分（1時間）。');
  });
});
