import { describe, expect, it, vi } from 'vitest';
import { loadWeeklyPlanningTraceAdminEntryPage } from './weeklyPlanningTraceAdminEntriesPage';

const SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';

function storedEntry(sequence: number): Record<string, unknown> {
  return {
    id: `${SESSION_ID}-${String(sequence).padStart(8, '0')}`,
    sessionId: SESSION_ID,
    sequence,
  };
}

describe('weekly planning trace admin entry page loader', () => {
  it('entryCount 256でも1requestあたり20 documentだけ取得する', async () => {
    const getDocument = vi.fn(async (_collection: string, id: string) => {
      const sequence = Number(id.slice(-8));
      return storedEntry(sequence);
    });

    const first = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 256 },
      -1,
      100,
    );

    expect(first.entries).toHaveLength(20);
    expect(first.totalEntryCount).toBe(256);
    expect(first.nextAfterSequence).toBe(19);
    expect(first.missingSequenceCount).toBe(0);
    expect(getDocument).toHaveBeenCalledTimes(20);

    getDocument.mockClear();
    const second = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 256 },
      first.nextAfterSequence ?? -1,
      20,
    );
    expect(second.entries[0]?.sequence).toBe(20);
    expect(second.entries[19]?.sequence).toBe(39);
    expect(second.nextAfterSequence).toBe(39);
    expect(getDocument).toHaveBeenCalledTimes(20);
  });

  it('欠落documentを捨ててもcursorをpage末尾まで進める', async () => {
    const getDocument = vi.fn(async (_collection: string, id: string) => {
      const sequence = Number(id.slice(-8));
      return sequence === 1 ? null : storedEntry(sequence);
    });

    const page = await loadWeeklyPlanningTraceAdminEntryPage(
      { getDocument },
      SESSION_ID,
      { entryCount: 4 },
      -1,
      3,
    );

    expect(page.entries.map((entry) => entry.sequence)).toEqual([0, 2]);
    expect(page.missingSequenceCount).toBe(1);
    expect(page.nextAfterSequence).toBe(2);
  });
});
