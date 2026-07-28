import { describe, expect, it, vi } from 'vitest';
import {
  collectWeeklyPlanningTraceAdminEntryPages,
  type WeeklyPlanningTraceAdminEntryPageFetcher,
} from './weeklyPlanningTracePaginatedAdminRepository';

const SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';

function entry(sequence: number): Record<string, unknown> {
  return {
    id: `${SESSION_ID}-${String(sequence).padStart(8, '0')}`,
    sessionId: SESSION_ID,
    sequence,
  };
}

describe('paginated weekly planning trace admin entries', () => {
  it('256 entriesを20件以下のpageへ分けて全件集約する', async () => {
    const totalEntryCount = 256;
    const implementation: WeeklyPlanningTraceAdminEntryPageFetcher = async ({
      afterSequence,
      limit,
    }) => {
      const start = afterSequence + 1;
      const endExclusive = Math.min(totalEntryCount, start + limit);
      return {
        entries: Array.from(
          { length: endExclusive - start },
          (_, index) => entry(start + index),
        ),
        totalEntryCount,
        nextAfterSequence: endExclusive < totalEntryCount ? endExclusive - 1 : null,
        missingSequenceCount: 0,
      };
    };
    const fetchPage = vi.fn(implementation);

    const entries = await collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage);

    expect(entries).toHaveLength(256);
    expect(fetchPage).toHaveBeenCalledTimes(13);
    expect(fetchPage.mock.calls.every(([params]) => params.limit === 20)).toBe(true);
    expect(entries[0]?.sequence).toBe(0);
    expect(entries[255]?.sequence).toBe(255);
  });

  it('欠落entryがあれば全page確認後に部分結果を拒否する', async () => {
    let callIndex = 0;
    const implementation: WeeklyPlanningTraceAdminEntryPageFetcher = async () => {
      callIndex += 1;
      return callIndex === 1
        ? {
            entries: [entry(0), entry(2)],
            totalEntryCount: 4,
            nextAfterSequence: 2,
            missingSequenceCount: 1,
          }
        : {
            entries: [entry(3)],
            totalEntryCount: 4,
            nextAfterSequence: null,
            missingSequenceCount: 0,
          };
    };
    const fetchPage = vi.fn(implementation);

    await expect(collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage))
      .rejects.toThrow(/1件欠落/);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('page間でtotalEntryCountが変わるresponseを拒否する', async () => {
    let callIndex = 0;
    const implementation: WeeklyPlanningTraceAdminEntryPageFetcher = async () => {
      callIndex += 1;
      return callIndex === 1
        ? {
            entries: [entry(0)],
            totalEntryCount: 2,
            nextAfterSequence: 0,
            missingSequenceCount: 0,
          }
        : {
            entries: [entry(1)],
            totalEntryCount: 3,
            nextAfterSequence: null,
            missingSequenceCount: 0,
          };
    };
    const fetchPage = vi.fn(implementation);

    await expect(collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage))
      .rejects.toThrow(/総件数がpage間で変化/);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('進まないcursorを拒否して無限loopを防ぐ', async () => {
    const implementation: WeeklyPlanningTraceAdminEntryPageFetcher = async () => ({
      entries: [entry(0)],
      totalEntryCount: 2,
      nextAfterSequence: -1,
      missingSequenceCount: 0,
    });
    const fetchPage = vi.fn(implementation);

    await expect(collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage))
      .rejects.toThrow(/cursorが不正/);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
