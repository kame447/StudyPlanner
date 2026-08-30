import { describe, expect, it } from 'vitest';
import type { TimetableTerm } from '../types/domain';
import { resolveActiveTimetableTerm } from './timetableTerm';

function term(params: Partial<TimetableTerm> & Pick<TimetableTerm, 'id'>): TimetableTerm {
  return {
    id: params.id,
    userId: 'user-1',
    year: 2026,
    kind: 'fullYear',
    label: params.id,
    isActive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...params,
  };
}

describe('resolveActiveTimetableTerm', () => {
  it('prefers the explicitly active term', () => {
    const active = term({ id: 'active', isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = term({ id: 'newer', updatedAt: '2026-08-01T00:00:00.000Z' });

    expect(resolveActiveTimetableTerm([newer, active])).toEqual({
      term: active,
      termId: 'active',
    });
  });

  it('prefers the legacy default term when no explicit active term exists', () => {
    const legacyDefault = term({ id: 'default', updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = term({ id: 'newer', updatedAt: '2026-08-01T00:00:00.000Z' });

    expect(resolveActiveTimetableTerm([newer, legacyDefault])).toEqual({
      term: legacyDefault,
      termId: 'default',
    });
  });

  it('falls back to the latest updated term when no active or legacy default exists', () => {
    const older = term({ id: 'older', updatedAt: '2026-01-01T00:00:00.000Z' });
    const latest = term({ id: 'latest', updatedAt: '2026-08-01T00:00:00.000Z' });

    expect(resolveActiveTimetableTerm([older, latest])).toEqual({
      term: latest,
      termId: 'latest',
    });
  });

  it('returns the legacy default id only when there are no terms', () => {
    expect(resolveActiveTimetableTerm([])).toEqual({
      term: null,
      termId: 'default',
    });
  });
});
