import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import {
  parseWeeklyPlanningVNextSessionCheckpoint as parseOld,
} from './weeklyPlanningVNextSessionCheckpoint.f27b3a66.fixture';
import {
  parseWeeklyPlanningVNextSessionCheckpoint as parseP1,
} from './weeklyPlanningVNextSessionCheckpoint.81b4bc45.fixture';
import {
  parseWeeklyPlanningVNextSessionCheckpoint as parseP3,
} from './weeklyPlanningVNextSessionCheckpoint.1d060128.fixture';
import {
  parseWeeklyPlanningVNextSessionCheckpoint as parseExpand,
  serializeWeeklyPlanningVNextSessionCheckpoint,
} from './weeklyPlanningVNextSessionCheckpoint';

const ownerId = 'expand-owner';
const weekStartDate = '2026-11-02';
const scope = { ownerId, weekStartDate };

it('accepts only validated optional fields in the expand parser while fixed historical parsers retain their own contract', () => {
  const baseRaw = serializeWeeklyPlanningVNextSessionCheckpoint({
    ...scope, conversationId: 'expand-conversation', savedAt: '2026-11-02T09:00:00.000Z',
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] },
  });
  expect(baseRaw).not.toBeNull();
  const base = JSON.parse(baseRaw!);
  const failureRecovery = { reason: 'provider_error', consecutiveCount: 1 };
  const unansweredQuestionStreak = { questionKey: 'missing_effort_estimate:work', graphRevision: 0, count: 1 };
  const withFields = (fields: Record<string, unknown>) => JSON.stringify({ ...base, vnext: { ...base.vnext, ...fields } });
  // Every column receives these exact same raw bytes. Snapshot fixtures are verbatim parser sources
  // from f27b3a66, 81b4bc45 and 1d060128, with their relative imports resolved in this directory.
  const cases = [
    { name: 'four keys', raw: baseRaw!, accepts: [true, true, true, true, true] },
    { name: 'failureRecovery', raw: withFields({ failureRecovery }), accepts: [false, false, true, true, true] },
    { name: 'unansweredQuestionStreak', raw: withFields({ unansweredQuestionStreak }), accepts: [false, false, true, false, true] },
    { name: 'both fields', raw: withFields({ failureRecovery, unansweredQuestionStreak }), accepts: [false, false, true, false, true] },
    { name: 'invalid failureRecovery', raw: withFields({ failureRecovery: { ...failureRecovery, consecutiveCount: '1' } }),
      accepts: [false, false, false, false, false] },
    { name: 'invalid unansweredQuestionStreak', raw: withFields({ unansweredQuestionStreak: { ...unansweredQuestionStreak, count: 0 } }),
      accepts: [false, false, false, false, false] },
  ] as const;
  const parsers = [
    ['f27b3a66', parseOld], ['1cc99d5f', parseOld], ['expand', parseExpand],
    ['81b4bc45', parseP1], ['1d060128', parseP3],
  ] as const;
  for (const row of cases) {
    parsers.forEach(([version, parse], index) => {
      expect.soft(parse({ raw: row.raw, ...scope }) !== null, `${row.name} × ${version}`).toBe(row.accepts[index]);
    });
  }

  // Expand changes acceptance only. Its ordinary four-key producer stays unchanged.
  expect(Object.keys(JSON.parse(baseRaw!).vnext)).toEqual(['state', 'presentedQuestion', 'preview', 'messages']);
  for (const fields of [{ failureRecovery }, { unansweredQuestionStreak }, { failureRecovery, unansweredQuestionStreak }]) {
    const parsed = parseExpand({ raw: withFields(fields), ...scope });
    if (parsed === null) continue; // The acceptance assertion above reports this separately on main.
    const serialized = serializeWeeklyPlanningVNextSessionCheckpoint({
      ownerId: parsed.ownerId, weekStartDate: parsed.weekStartDate,
      conversationId: parsed.conversationId, vnext: parsed.vnext, savedAt: parsed.savedAt,
    });
    expect.soft(serialized).not.toBeNull();
    if (serialized !== null) {
      for (const [field, value] of Object.entries(fields)) {
        expect.soft(JSON.parse(serialized).vnext[field], `parse/serialize preserves ${field}`).toEqual(value);
      }
    }
  }
});

describe('expanded checkpoint value contract', () => {
  const base = () => JSON.parse(serializeWeeklyPlanningVNextSessionCheckpoint({
    ...scope, conversationId: 'expand-conversation', savedAt: '2026-11-02T09:00:00.000Z',
    vnext: { state: createEmptyWeeklyPlanningVNextState(), presentedQuestion: null, preview: null, messages: [] },
  })!);
  const failureRecovery = { reason: 'provider_error', consecutiveCount: 1 };
  const unansweredQuestionStreak = { questionKey: 'missing_effort_estimate:work', graphRevision: 0, count: 1 };

  it.each(['provider_error', 'unparseable', 'rejected_after_repair'])('retains the supported failure reason %s', reason => {
    const checkpoint = base();
    checkpoint.vnext.failureRecovery = { reason, consecutiveCount: Number.MAX_SAFE_INTEGER };
    checkpoint.vnext.unansweredQuestionStreak = { ...unansweredQuestionStreak, count: Number.MAX_SAFE_INTEGER };
    const parsed = parseExpand({ raw: JSON.stringify(checkpoint), ...scope });
    expect(parsed?.vnext.failureRecovery).toEqual(checkpoint.vnext.failureRecovery);
    expect(parsed?.vnext.unansweredQuestionStreak).toEqual(checkpoint.vnext.unansweredQuestionStreak);
  });

  it.each([
    ['failureRecovery', null],
    ['failureRecovery', { ...failureRecovery, reason: 'unknown' }],
    ['failureRecovery', { reason: 'provider_error' }],
    ['failureRecovery', { ...failureRecovery, extra: true }],
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(consecutiveCount =>
      ['failureRecovery', { ...failureRecovery, consecutiveCount }]),
    ['unansweredQuestionStreak', null],
    ['unansweredQuestionStreak', { ...unansweredQuestionStreak, questionKey: '' }],
    ['unansweredQuestionStreak', { questionKey: 'question', count: 1 }],
    ['unansweredQuestionStreak', { ...unansweredQuestionStreak, extra: true }],
    ...[-1, 0.5, '0', Number.MAX_SAFE_INTEGER + 1].map(graphRevision =>
      ['unansweredQuestionStreak', { ...unansweredQuestionStreak, graphRevision }]),
    ...[0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1].map(count =>
      ['unansweredQuestionStreak', { ...unansweredQuestionStreak, count }]),
    ['futureField', {}],
  ])('rejects the whole checkpoint for an invalid %s', (field, value) => {
    const checkpoint = base();
    checkpoint.vnext[field as string] = value;
    const raw = JSON.stringify(checkpoint);
    expect(parseExpand({ raw, ...scope })).toBeNull();
  });
});
