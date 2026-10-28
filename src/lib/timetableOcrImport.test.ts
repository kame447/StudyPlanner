import { expect, it } from 'vitest';
import { normalizeTimetableOcrResult } from './timetableOcrImport';

it.each([
  ['', '', ''], [' memo ', '', 'memo'], ['', ' note ', 'note'],
  [' memo ', ' note ', 'memo / note'], [null, 42, ''],
])('keeps OCR memo %j and note %j normalization', (memo, note, expected) => {
  const result = normalizeTimetableOcrResult({ items: [{ title: 'Math', weekday: 'mon', memo, note }] });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].memo).toBe(expected);
});
