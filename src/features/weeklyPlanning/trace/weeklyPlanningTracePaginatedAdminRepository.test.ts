import { describe, expect, it } from 'vitest';
import { collectWeeklyPlanningTraceAdminEntryPages } from './weeklyPlanningTracePaginatedAdminRepository';

const SESSION_ID = 'weekly-trace-123e4567-e89b-52d3-a456-426614174000';

type TestPageFetcher = (params: {
  sessionId: string;
  afterSequence: number;
  limit: number;
}) => Promise<{
  entries: Record<string, unknown>[];
  totalEntryCount: number;
  nextAfterSequence: number | null;
  missingSequenceCount: number;
}>;

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
    const requestedLimits: number[] = [];
    let callCount = 0;
    const fetchPage: TestPageFetcher = async ({ afterSequence, limit }) => {
      callCount += 1;
      requestedLimits.push(limit);
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

    const entries = await collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage);

    expect(entries).toHaveLength(256);
    expect(callCount).toBe(13);
    expect(requestedLimits.every((limit) => limit === 20)).toBe(true);
    expect(entries[0]?.sequence).toBe(0);
    expect(entries[255]?.sequence).toBe(255);
  });

  it('欠落entryがあれば全page確認後に部分結果を拒否する', async () => {
    let callCount = 0;
    const fetchPage: TestPageFetcher = async () => {
      callCount += 1;
      return callCount === 1
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

    await expect(collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage))
      .rejects.toThrow(/1件欠落/);
    expect(callCount).toBe(2);
  });

  it('page間でtotalEntryCountが変わるresponseを拒否する', async () => {
    let callCount = 0;
    const fetchPage: TestPageFetcher = async () => {
      callCount += 1;
      return callCount === 1
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

    await expect(collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage))
      .rejects.toThrow(/総件数がpage間で変化/);
    expect(callCount).toBe(2);
  });

  it('進まないcursorを拒否して無限loopを防ぐ', async () => {
    let callCount = 0;
    const fetchPage: TestPageFetcher = async () => {
      callCount += 1;
      return {
        entries: [entry(0)],
        totalEntryCount: 2,
        nextAfterSequence: -1,
        missingSequenceCount: 0,
      };
    };

    await expect(collectWeeklyPlanningTraceAdminEntryPages(SESSION_ID, fetchPage))
      .rejects.toThrow(/cursorが不正/);
    expect(callCount).toBe(1);
  });
});
