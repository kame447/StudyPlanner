import { expect, it } from 'vitest';
import { assertStartupTimingRow } from '../../tests/e2e/support/startup-timing-contract.mjs';
import { STARTUP_INTRO_OUTCOMES, STARTUP_PHASES } from '../../src/lib/startupTiming';

const INTRO_REASONS = ['ended', 'skipped', 'reduced-motion', 'autoplay-blocked', 'media-error', 'stalled'];
const row = (phase = 'profile') => ({ id: 1, phase, startMs: 10, durationMs: 20, outcome: 'success' });
const intro = (reason = 'ended') => ({ ...row('intro-complete'), introOutcome: reason });

it('pins the six intro reasons independently of the recorder implementation', () => {
  expect(STARTUP_INTRO_OUTCOMES).toEqual(INTRO_REASONS);
});
it.each(STARTUP_PHASES.filter(phase => phase !== 'intro-complete'))('retains exactly the five existing keys for %s', phase => {
  expect(() => assertStartupTimingRow(row(phase))).not.toThrow();
  expect(() => assertStartupTimingRow({ ...row(phase), introOutcome: 'ended' })).toThrow();
});
it.each(INTRO_REASONS)('accepts only the documented extra intro field for %s', reason => {
  expect(() => assertStartupTimingRow(intro(reason))).not.toThrow();
});
it.each([undefined, null, '', 'fixture-secret-token', 'unknown', 42, {}, ['ended']])('rejects invalid or private intro reason %j', reason => {
  expect(() => assertStartupTimingRow({ ...row('intro-complete'), introOutcome: reason })).toThrow();
});
it('rejects a missing intro reason rather than falling back to the old row shape', () => {
  expect(() => assertStartupTimingRow(row('intro-complete'))).toThrow();
});
for (const phase of ['profile', 'startup-wait-ended', 'intro-complete']) {
  it.each(['ownerId', 'token', 'email', 'payload', 'requestUrl', 'unexpected'])(`rejects an extra %s field on ${phase}`, key => {
    const value = phase === 'intro-complete' ? intro() : row(phase);
    expect(() => assertStartupTimingRow({ ...value, [key]: 'fixture-private-value' })).toThrow();
  });
}
it.each(['id', 'phase', 'startMs', 'durationMs', 'outcome'])('rejects a missing common key: %s', key => {
  const value = row(); delete value[key];
  expect(() => assertStartupTimingRow(value)).toThrow();
});
it.each([NaN, Infinity, -Infinity, '10', undefined])('preserves numeric timing checks for %j', value => {
  expect(() => assertStartupTimingRow({ ...row(), startMs: value })).toThrow();
  expect(() => assertStartupTimingRow({ ...row(), durationMs: value })).toThrow();
});
it('preserves pending rows with null duration', () => {
  expect(() => assertStartupTimingRow({ ...row(), durationMs: null, outcome: 'pending' })).not.toThrow();
});
