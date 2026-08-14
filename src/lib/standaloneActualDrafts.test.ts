import { describe, expect, it } from 'vitest';
import {
  createStandaloneActualCandidate,
  createStandaloneActualDraft,
  getStandaloneActualDurationMinutes,
  resolveStandaloneActualEndTime,
} from './standaloneActualDrafts';
import type { Actual } from '../types/domain';

const actual: Actual = {
  id: 'actual-1',
  userId: 'user-1',
  planId: null,
  occurrenceDate: '2026-08-14',
  actualStartTime: '22:30',
  actualEndTime: '23:30',
  title: '英語復習',
  subject: '英語',
  note: '復習',
  isAlignedToPlan: false,
  updatedAt: '2026-08-14T23:30:00.000Z',
  materialId: 'material-1',
  materialName: '英単語帳',
};

describe('standaloneActualDrafts', () => {
  it('derives the initial duration from the existing actual', () => {
    expect(getStandaloneActualDurationMinutes(actual)).toBe(60);
  });

  it('keeps the standalone editor same-day end-time clamp', () => {
    expect(resolveStandaloneActualEndTime('23:30', 60)).toBe('24:00');
    expect(resolveStandaloneActualEndTime('23:30', 24 * 60)).toBeNull();
  });

  it('builds a trimmed standalone draft while preserving material provenance', () => {
    expect(
      createStandaloneActualDraft(actual, {
        occurrenceDate: '2026-08-15',
        startTime: '19:00',
        endTime: '20:30',
        title: '  英語レポート  ',
        subject: '  英語  ',
        note: '  続き  ',
      }),
    ).toEqual({
      userId: 'user-1',
      planId: null,
      occurrenceDate: '2026-08-15',
      actualStartTime: '19:00',
      actualEndTime: '20:30',
      title: '英語レポート',
      subject: '英語',
      isAlignedToPlan: false,
      note: '続き',
      materialId: 'material-1',
      materialName: '英単語帳',
      materialProgressUpdates: undefined,
    });
  });

  it('projects an edited draft onto the existing actual identity', () => {
    const draft = createStandaloneActualDraft(actual, {
      occurrenceDate: '2026-08-15',
      startTime: '19:00',
      endTime: '20:30',
      title: '英語レポート',
      subject: '英語',
      note: '続き',
    });

    expect(createStandaloneActualCandidate(actual, draft)).toMatchObject({
      id: 'actual-1',
      planId: null,
      occurrenceDate: '2026-08-15',
      actualStartTime: '19:00',
      actualEndTime: '20:30',
      title: '英語レポート',
      subject: '英語',
      note: '続き',
      isAlignedToPlan: false,
    });
  });
});
