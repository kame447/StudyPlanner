import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  notSavedYet, placement, savedAtLeastOnce, savedExactlyOnce, savedFor, unchangedSince,
} from './support/schedule-event-ledger.mjs';

// Controls for the checks the emulator specs rely on. The document list is the real schedule_events list
// captured from a run of the synthetic emulator spec (one approved study plan); the corrupted lists below
// are deliberate copies of it. The fixed-event cases reuse the same captured document under another title,
// because that spec registers no fixed event; the checks only look at user, title, date and placement.
const captured = JSON.parse(readFileSync(new URL('./fixtures/schedule-events.synthetic-run.json', import.meta.url), 'utf8'));
const field = (document, name) => document.fields[name].stringValue;
const userId = field(captured[0], 'userId');
const study = { userId, title: 'ゼミ資料' };

function copy(document, { id, title, startTime, endTime, userId: owner } = {}) {
  const next = structuredClone(document);
  if (id) { next.fields.id.stringValue = id; next.name = next.name.replace(/[^/]+$/, id); }
  if (title) next.fields.title.stringValue = title;
  if (startTime) next.fields.startTime.stringValue = startTime;
  if (endTime) next.fields.endTime.stringValue = endTime;
  if (owner) next.fields.userId.stringValue = owner;
  return next;
}

const piano = copy(captured[0], { id: 'plan:piano', title: 'ピアノ教室', startTime: '19:00', endTime: '20:00' });
const fixed = { userId, title: 'ピアノ教室', date: field(piano, 'date') };

test('the captured list is a saved study plan for one user', () => {
  expect(captured).toHaveLength(1);
  expect(savedFor(captured, study)).toHaveLength(1);
});

test('the correct flow passes every check', () => {
  expect(notSavedYet([], study)).toEqual([]);
  expect(notSavedYet([], fixed)).toEqual([]);
  expect(savedAtLeastOnce(captured, study)).toEqual([]);
  const before = placement(savedFor(captured, study));
  const afterRegistration = [...captured, piano];
  expect(notSavedYet(captured, fixed)).toEqual([]);
  expect(savedExactlyOnce(afterRegistration, fixed)).toEqual([]);
  expect(unchangedSince(before, afterRegistration, study)).toEqual([]);
  expect(unchangedSince(placement(savedFor(afterRegistration, fixed)), afterRegistration, fixed)).toEqual([]);
});

test('a split study plan still passes: the check does not pin the study block count', () => {
  const split = [...captured, copy(captured[0], { id: 'plan:second-block', startTime: '12:00', endTime: '12:30' })];
  expect(savedAtLeastOnce(split, study)).toEqual([]);
  expect(unchangedSince(placement(savedFor(split, study)), split, study)).toEqual([]);
});

test('a fixed-event save made twice is caught', () => {
  const twice = [...captured, piano, copy(piano, { id: 'plan:piano-again' })];
  expect(savedExactlyOnce(twice, fixed)).not.toEqual([]);
  // The same event written again after a reload keeps its title but not its identity.
  const first = placement(savedFor([...captured, piano], fixed));
  expect(unchangedSince(first, twice, fixed)).not.toEqual([]);
});

test('a fixed event moved or rewritten after saving is caught', () => {
  const first = placement(savedFor([...captured, piano], fixed));
  expect(unchangedSince(first, [...captured, copy(piano, { startTime: '19:30' })], fixed)).not.toEqual([]);
  expect(unchangedSince(first, [...captured, copy(piano, { id: 'plan:piano-rewritten' })], fixed)).not.toEqual([]);
});

test('a study plan saved before approval is caught', () => {
  // The preview and the correction are shown, nothing is approved: the list must hold no study plan yet.
  expect(notSavedYet(captured, study)).not.toEqual([]);
  expect(notSavedYet([], study)).toEqual([]);
});

test('a study block added by the registration turn is caught', () => {
  const before = placement(savedFor(captured, study));
  const extra = [...captured, copy(captured[0], { id: 'plan:extra-study', startTime: '21:00', endTime: '21:30' })];
  expect(unchangedSince(before, extra, study)).not.toEqual([]);
});

test('another account\'s documents never count', () => {
  const others = [copy(captured[0], { id: 'plan:other', userId: 'someone-else' }), copy(piano, { id: 'plan:other-piano', userId: 'someone-else' })];
  expect(savedFor(others, study)).toEqual([]);
  expect(savedExactlyOnce([...captured, piano, ...others], fixed)).toEqual([]);
  expect(notSavedYet(others, study)).toEqual([]);
});
