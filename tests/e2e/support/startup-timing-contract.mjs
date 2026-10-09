import assert from 'node:assert/strict';

const BASE_KEYS = ['durationMs', 'id', 'outcome', 'phase', 'startMs'];
const INTRO_KEYS = ['durationMs', 'id', 'introOutcome', 'outcome', 'phase', 'startMs'];
const INTRO_OUTCOMES = ['ended', 'skipped', 'reduced-motion', 'autoplay-blocked', 'media-error', 'stalled'];

// This is an independent privacy contract for diagnostic output, not a permissive
// projection: extra fields must fail rather than be removed before comparison.
export function assertStartupTimingRow(row) {
  const intro = row.phase === 'intro-complete';
  assert.deepEqual(Object.keys(row).sort(), intro ? INTRO_KEYS : BASE_KEYS);
  if (intro) assert.ok(INTRO_OUTCOMES.includes(row.introOutcome), 'introOutcome must be a fixed public reason');
  assert.ok(Number.isFinite(row.startMs), 'startMs must be finite');
  assert.ok(row.durationMs === null || Number.isFinite(row.durationMs), 'durationMs must be null or finite');
}
