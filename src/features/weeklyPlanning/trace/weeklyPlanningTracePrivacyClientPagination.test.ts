import { describe, expect, it, vi } from 'vitest';
import { collectWeeklyPlanningTraceAdminEntryPages } from './weeklyPlanningTracePrivacyClient';

describe('collectWeeklyPlanningTraceAdminEntryPages', () => {
  it('loads every page until the server cursor is null', async () => {
    const fetchPage = vi.fn(async (afterSequence: number) => {
      if (afterSequence === -1) {
        return {
          entries: Array.from({ length: 20 }, (_, sequence) => ({ sequence })),
          nextAfterSequence: 19,
        };
      }
      if (afterSequence === 19) {
        return {
          entries: Array.from({ length: 20 }, (_, index) => ({ sequence: index + 20 })),
          nextAfterSequence: 39,
        };
      }
      return {
        entries: [{ sequence: 40 }, { sequence: 41 }],
        nextAfterSequence: null,
      };
    });

    const entries = await collectWeeklyPlanningTraceAdminEntryPages(fetchPage);

    expect(entries).toHaveLength(42);
    expect(entries[0]?.sequence).toBe(0);
    expect(entries[entries.length - 1]?.sequence).toBe(41);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([-1, 19, 39]);
  });

  it('rejects a cursor that does not advance instead of looping', async () => {
    await expect(collectWeeklyPlanningTraceAdminEntryPages(async () => ({
      entries: [{ sequence: 0 }],
      nextAfterSequence: -1,
    }))).rejects.toThrow(/ページ送り情報が不正/);
  });

  it('fails closed instead of exporting only the first 500 entries', async () => {
    const fetchPage = vi.fn(async (afterSequence: number) => {
      const start = afterSequence + 1;
      return {
        entries: Array.from({ length: 20 }, (_, index) => ({ sequence: start + index })),
        nextAfterSequence: start + 19,
      };
    });

    await expect(collectWeeklyPlanningTraceAdminEntryPages(fetchPage))
      .rejects.toThrow(/最大ページ数を超え/);
    expect(fetchPage).toHaveBeenCalledTimes(25);
  });
});
