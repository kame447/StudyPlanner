import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isObservabilityActorSubject,
  readActiveUsers,
  readCheckpoint,
  readDailyRollup,
  readUserSummary,
} from './productObservabilityReadModelCodec';
import { createEmptyDailyRollup } from './productObservabilityReadModelProjection';

afterEach(() => vi.useRealTimers());

describe('observability stored-document decoding', () => {
  it('keeps missing checkpoint defaults and resolves the clock on each read', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-11-02T00:00:00.000Z');
    const first = readCheckpoint(null);
    expect(first).toMatchObject({ cursor: null, processedEventCount: 0, activeUserDirtySources: [], updatedAt: '2026-11-02T00:00:00.000Z' });
    vi.setSystemTime('2026-11-02T01:00:00.000Z');
    expect(readCheckpoint(null).updatedAt).toBe('2026-11-02T01:00:00.000Z');
  });

  it('keeps the highest dirty revision per environment and date in canonical order', () => {
    expect(readCheckpoint({ activeUserDirtySources: [
      { environment: 'production', localDate: '2026-11-02', revision: 2 },
      { environment: 'preview', localDate: '2026-11-01', revision: 3 },
      { environment: 'production', localDate: '2026-11-02', revision: 1 },
    ] }).activeUserDirtySources).toEqual([
      { environment: 'preview', localDate: '2026-11-01', revision: 3 },
      { environment: 'production', localDate: '2026-11-02', revision: 2 },
    ]);
  });

  it('removes storage identity without changing or mutating a valid daily rollup', () => {
    const daily = createEmptyDailyRollup({ environment: 'production', localDate: '2026-11-02', nowIso: '2026-11-02T00:00:00.000Z' });
    const stored = { ...daily, id: 'production:2026-11-02' };
    expect(readDailyRollup(stored, 'production', '2026-11-02')).toEqual(daily);
    expect(stored.id).toBe('production:2026-11-02');
    expect(readDailyRollup(null, 'production', '2026-11-02')).toBeNull();
    expect(() => readDailyRollup(stored, 'preview', '2026-11-02')).toThrow('observability_daily_rollup_invalid');
  });

  it('removes both user storage fields while accepting the existing unenriched document', () => {
    const user = {
      schemaVersion: 1, actorSubjectId: 'actor-12345678',
      firstActivityAt: '2026-11-02T00:00:00.000Z', lastActivityAt: '2026-11-02T00:00:00.000Z',
      firstActivityDate: '2026-11-02', lastActivityDate: '2026-11-02',
      eventCount: 1, productActivityCount: 1, aiRequestCount: 0, planningOutcomeCount: 0,
    };
    const stored = { ...user, id: 'actor-12345678', documentName: 'documents/users/actor-12345678' };
    expect(readUserSummary(stored)).toEqual(user);
    expect(stored.documentName).toBe('documents/users/actor-12345678');
  });

  it('keeps dirty snapshot suppression before document validation', () => {
    const malformed = { schemaVersion: -1 };
    const dirty = [{ environment: 'production' as const, localDate: '2026-11-02', revision: 1 }];
    expect(readActiveUsers(malformed, 'production', '2026-11-02', dirty)).toBeNull();
    expect(() => readActiveUsers(malformed, 'production', '2026-11-02', [])).toThrow('observability_active_user_snapshot_invalid');
    expect(readActiveUsers(null, 'production', '2026-11-02', [])).toBeNull();
  });

  it('shares the unchanged non-stateful actor identity pattern', () => {
    const actor = 'actor-12345678';
    expect(isObservabilityActorSubject(actor)).toBe(true);
    expect(isObservabilityActorSubject(actor)).toBe(true);
    expect(isObservabilityActorSubject('actor-1234567')).toBe(false);
    expect(isObservabilityActorSubject(` ${actor}`)).toBe(false);
  });
});
