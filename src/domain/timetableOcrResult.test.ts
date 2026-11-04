import { expect, it, vi } from 'vitest';
import { inferSubjectFromTitle, isClassroomOnlyTitle, normalizeTimetableOcrResult } from './timetableOcrResult';

// These rules must be usable by the editor without initializing transport dependencies.
vi.mock('../lib/firebaseClient', () => { throw new Error('Candidate rules must not initialize Firebase'); });
vi.mock('../lib/aiConfig', () => { throw new Error('Candidate rules must not load proxy configuration'); });
vi.mock('../lib/aiImageAttachment', () => { throw new Error('Candidate rules must not load image transport'); });

it.each([
  ['', '', ''], [' memo ', '', 'memo'], ['', ' note ', 'note'],
  [' memo ', ' note ', 'memo / note'], [null, 42, ''],
])('keeps OCR memo %j and note %j normalization', (memo, note, expected) => {
  const result = normalizeTimetableOcrResult({ items: [{ title: 'Math', weekday: 'mon', memo, note }] });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].memo).toBe(expected);
});

it.each([null, undefined, false, 42, 'ocr', {}, { periods: {}, items: null }])(
  'returns empty candidates for missing or non-list input %j',
  value => expect(normalizeTimetableOcrResult(value)).toEqual({ periods: [], items: [] }),
);

it('keeps object rows in order while ignoring non-object candidates', () => {
  expect(normalizeTimetableOcrResult({
    periods: [null, false, 'one', { periodNumber: 2 }, { periodNumber: 1 }],
    items: [null, 42, 'class', {}, { title: ' 数学Ⅰ ', subject: ' 独自教科 ', classroom: ' 402 ' }],
  })).toEqual({
    periods: [
      { periodNumber: 2, startTime: null, endTime: null },
      { periodNumber: 1, startTime: null, endTime: null },
    ],
    items: [
      { weekday: '', periodNumber: null, startTime: null, endTime: null, title: '', subject: '', classroom: '', memo: '' },
      { weekday: '', periodNumber: null, startTime: null, endTime: null, title: '数学Ⅰ', subject: '独自教科', classroom: '402', memo: '' },
    ],
  });
});

it('preserves weekday aliases and the existing full-name case distinction', () => {
  const weekdays = [' 月曜日 ', '火', '水曜', '木曜日', '金', '土曜', '日曜日', ' MON ', 'tuesday', 'Wednesday', 'sun', null];
  const result = normalizeTimetableOcrResult({ items: weekdays.map(weekday => ({ weekday })) });
  expect(result.items.map(item => item.weekday)).toEqual([
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'mon', 'tue', '', 'sun', '',
  ]);
});

it('rounds period numbers before applying the existing one-to-twelve range', () => {
  const values = [' 1 ', 1.49, 1.5, 0.5, 12.49, 12.5, 0, 13, '', null, 'one', Infinity];
  const result = normalizeTimetableOcrResult({
    periods: values.map(periodNumber => ({ periodNumber })),
    items: values.map(periodNumber => ({ periodNumber })),
  });
  expect(result.periods.map(period => period.periodNumber)).toEqual([1, 1, 2, 1, 12]);
  expect(result.items.map(item => item.periodNumber)).toEqual([1, 1, 2, 1, 12, null, null, null, null, null, null, null]);
});

it('uses the last duplicate period for missing times and preserves explicit formatted times', () => {
  const result = normalizeTimetableOcrResult({
    periods: [
      { periodNumber: 1, startTime: '08:00', endTime: '09:00' },
      { periodNumber: 1, startTime: ' 10:00 ', endTime: ' 11:00 ' },
      { periodNumber: 2, startTime: '9:00', endTime: ' 99:99 ' },
    ],
    items: [
      { periodNumber: 1, startTime: '9:00', endTime: null },
      { periodNumber: '1', startTime: ' 12:34 ', endTime: '99:99' },
      { periodNumber: 2, startTime: false, endTime: '' },
      { periodNumber: 3, startTime: 'noon', endTime: '12:00:00' },
    ],
  });
  expect(result.periods).toEqual([
    { periodNumber: 1, startTime: '08:00', endTime: '09:00' },
    { periodNumber: 1, startTime: '10:00', endTime: '11:00' },
    { periodNumber: 2, startTime: null, endTime: '99:99' },
  ]);
  expect(result.items.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
    ['10:00', '11:00'], ['12:34', '99:99'], [null, '99:99'], [null, null],
  ]);
});

it('does not mutate the input or share result records with it', () => {
  const period = Object.freeze({ periodNumber: ' 2 ', startTime: ' 10:00 ', endTime: '11:00' });
  const item = Object.freeze({ weekday: ' 月 ', periodNumber: 2, title: ' 英語Ⅰ ', memo: ' memo ', note: ' note ' });
  const input = Object.freeze({ periods: Object.freeze([period]), items: Object.freeze([item]) });
  const result = normalizeTimetableOcrResult(input);
  expect(result.periods[0]).not.toBe(period);
  expect(result.items[0]).not.toBe(item);
  expect(result.items[0]).toEqual({
    weekday: 'mon', periodNumber: 2, startTime: '10:00', endTime: '11:00',
    title: '英語Ⅰ', subject: '英語', classroom: '', memo: 'memo / note',
  });
  expect(input.items[0].title).toBe(' 英語Ⅰ ');
});


it.each([
  [' 数学Ⅰ ', '数学'], ['英語演習', '英語'], ['日本史B', '日本史'],
  ['完全習得英語Ⅰ', ''], ['理系数学', ''], ['', ''],
])('preserves title subject inference for %j', (title, expected) => {
  expect(inferSubjectFromTitle(title)).toBe(expected);
});

it.each([
  [' 402 ', true], ['Ａ４０２-b', true], ['Room', true],
  ['数学402', false], ['4 02', false], ['402号室', false], ['', false],
])('preserves classroom-only detection for %j', (title, expected) => {
  expect(isClassroomOnlyTitle(title)).toBe(expected);
});
