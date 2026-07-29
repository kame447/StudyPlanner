import { describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningTraceArchiveEntryCount } from './weeklyPlanningTraceAdminArchive';

describe('weekly planning trace archive entry boundary', () => {
  it('export済みentry件数がないrequestを拒否する', () => {
    expect(resolveWeeklyPlanningTraceArchiveEntryCount(
      { entryCount: 12 },
      undefined,
    )).toEqual({ ok: false, reason: 'requested_count_invalid' });
  });

  it('export完了後にentryが増えてもexport済み境界を古い件数へ固定する', () => {
    expect(resolveWeeklyPlanningTraceArchiveEntryCount(
      { entryCount: 13 },
      12,
    )).toEqual({ ok: true, archivedEntryCount: 12 });
  });

  it('保存済み件数を超えるexport snapshotを拒否する', () => {
    expect(resolveWeeklyPlanningTraceArchiveEntryCount(
      { entryCount: 12 },
      13,
    )).toEqual({ ok: false, reason: 'requested_count_ahead' });
  });

  it('不正な保存件数と要求件数を拒否する', () => {
    expect(resolveWeeklyPlanningTraceArchiveEntryCount(
      { entryCount: -1 },
      0,
    )).toEqual({ ok: false, reason: 'stored_count_invalid' });
    expect(resolveWeeklyPlanningTraceArchiveEntryCount(
      { entryCount: 12 },
      1.5,
    )).toEqual({ ok: false, reason: 'requested_count_invalid' });
  });
});
