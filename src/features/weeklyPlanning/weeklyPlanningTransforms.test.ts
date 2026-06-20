import { describe, expect, it } from 'vitest';
import type { PlanDraft } from '../../types/domain';
import {
  createFallbackWeeklyDraftBlock,
  createPlanDraftFromWeeklyDraftBlock,
  createSimpleWeeklyDraftBlocksFromText,
  createWeeklyDraftBlockFromPlanDraft,
  distributeWeeklyDraftBlocks,
  looksLikeWeeklyPlanningRequest,
} from './weeklyPlanningTransforms';

function planDraft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    userId: 'user-1',
    title: '英語課題',
    subject: '英語',
    date: '2026-06-22',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: 'unit 3',
    sourceType: 'manual',
    sourceId: null,
    materialId: 'material-1',
    materialName: '英語ワーク',
    ...overrides,
  };
}

function minutesBetween(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);

  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}

function minutesFromClock(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function totalDraftMinutes(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): number {
  return blocks.reduce(
    (sum, block) => sum + minutesBetween(block.startTime, block.endTime),
    0,
  );
}

function totalsByTitle(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): Record<string, number> {
  return blocks.reduce<Record<string, number>>((totals, block) => {
    totals[block.title] =
      (totals[block.title] ?? 0) +
      minutesBetween(block.startTime, block.endTime);
    return totals;
  }, {});
}

function blocksGroupedByDate(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): Record<string, ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>> {
  return blocks.reduce<
    Record<string, ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>>
  >((groups, block) => {
    groups[block.date] = [...(groups[block.date] ?? []), block];
    return groups;
  }, {});
}

function expectBlocksSortedByDateAndStartTime(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): void {
  const seenDates = new Set<string>();
  let previousDate = '';
  let previousStartMinutes = -1;

  blocks.forEach((block) => {
    if (previousDate && block.date !== previousDate) {
      seenDates.add(previousDate);
      expect(seenDates.has(block.date)).toBe(false);
    }

    expect(block.date.localeCompare(previousDate)).toBeGreaterThanOrEqual(0);

    if (block.date === previousDate) {
      expect(minutesFromClock(block.startTime)).toBeGreaterThanOrEqual(
        previousStartMinutes,
      );
    }

    previousDate = block.date;
    previousStartMinutes = minutesFromClock(block.startTime);
  });
}

describe('weeklyPlanningTransforms', () => {
  it('keeps weekly drafts separate from saved plan ids and occurrence keys', () => {
    const block = createWeeklyDraftBlockFromPlanDraft(planDraft());

    expect(block.id).toMatch(/^weekly-draft-/);
    expect(block.status).toBe('draft');
    expect(block.source).toBe('ai');
    expect(block.userEdited).toBe(false);
    expect('planId' in block).toBe(false);
    expect('occurrenceKey' in block).toBe(false);
  });

  it('converts a weekly draft to a normal one-off PlanDraft on approval', () => {
    const block = createWeeklyDraftBlockFromPlanDraft(planDraft());
    const savedDraft = createPlanDraftFromWeeklyDraftBlock(block, 'user-1');

    expect(savedDraft).toMatchObject({
      userId: 'user-1',
      title: '英語課題',
      subject: '英語',
      date: '2026-06-22',
      startTime: '19:00',
      endTime: '20:00',
      repeat: 'none',
      type: 'study',
      materialId: 'material-1',
      materialName: '英語ワーク',
    });
    expect(savedDraft.recurrenceRules).toEqual([]);
  });

  it('builds separate weekly drafts from simple task duration input', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '英語を3時間、計算理論を4時間、卒研を2時間',
    });

    expect(blocks).toHaveLength(5);
    expect(blocks.map((block) => block.title)).toEqual([
      '英語',
      '計算理論',
      '卒研',
      '英語',
      '計算理論',
    ]);
    expect(blocks.map((block) => block.subject)).toEqual([
      '英語',
      '計算理論',
      '卒研',
      '英語',
      '計算理論',
    ]);
    expect(blocks.map((block) => block.label)).toEqual([
      '英語',
      '計算理論',
      '卒研',
      '英語',
      '計算理論',
    ]);
    expect(blocks.map((block) => block.memo)).toEqual([
      '元見積もり: 180分 / 分割 1/2 / 簡易生成',
      '元見積もり: 240分 / 分割 1/2 / 簡易生成',
      '見積もり: 120分 / 簡易生成',
      '元見積もり: 180分 / 分割 2/2 / 簡易生成',
      '元見積もり: 240分 / 分割 2/2 / 簡易生成',
    ]);
    expect(blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      120,
      120,
      120,
      60,
      120,
    ]);
    expect(totalDraftMinutes(blocks)).toBe(540);
    expect(blocks.every((block) => block.status === 'draft')).toBe(true);
    expect(blocks.every((block) => block.source === 'ai')).toBe(true);
  });

  it('places next-week simple drafts after the selected date on separate days', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を3時間、計算理論を4時間、卒研を2時間やりたい',
    });

    expect(blocks.map((block) => block.date)).toEqual([
      '2026-06-26',
      '2026-06-27',
      '2026-06-28',
      '2026-06-29',
      '2026-06-30',
    ]);
    expect(blocks.every((block) => block.date > '2026-06-19')).toBe(true);
    expect(blocks.map((block) => `${block.startTime}-${block.endTime}`)).toEqual([
      '19:00-21:00',
      '19:00-21:00',
      '19:00-21:00',
      '19:00-20:00',
      '19:00-21:00',
    ]);
  });

  it('distributes simple weekly drafts across the six-day planning range without changing metadata', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '英語を3時間、計算理論を4時間、卒研を2時間',
    });

    expect(totalDraftMinutes(blocks)).toBe(540);
    expect(blocks.map((block) => block.date)).toEqual([
      '2026-06-19',
      '2026-06-20',
      '2026-06-21',
      '2026-06-22',
      '2026-06-23',
    ]);
    expect(new Set(blocks.map((block) => block.date)).size).toBe(5);
    expect(
      blocks.every(
        (block) => block.date >= '2026-06-19' && block.date <= '2026-06-24',
      ),
    ).toBe(true);
    expectBlocksSortedByDateAndStartTime(blocks);
    expect(blocks.map((block) => [block.title, block.subject, block.label])).toEqual([
      ['英語', '英語', '英語'],
      ['計算理論', '計算理論', '計算理論'],
      ['卒研', '卒研', '卒研'],
      ['英語', '英語', '英語'],
      ['計算理論', '計算理論', '計算理論'],
    ]);
  });

  it('keeps heavy weekly drafts non-overlapping within each day', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を7時間、計算理論を8時間、線形代数を5時間、卒研を6時間、Java実装を4時間、レポート作成を3時間やりたい',
    });
    const groupedBlocks = blocksGroupedByDate(blocks);

    expect(blocks).toHaveLength(18);
    expect(totalDraftMinutes(blocks)).toBe(1980);
    expect(totalsByTitle(blocks)).toEqual({
      英語: 420,
      計算理論: 480,
      線形代数: 300,
      卒研: 360,
      Java実装: 240,
      レポート作成: 180,
    });
    expect(
      blocks.every(
        (block) => block.date >= '2026-06-26' && block.date <= '2026-07-01',
      ),
    ).toBe(true);
    expectBlocksSortedByDateAndStartTime(blocks);
    expect(
      blocks.every(
        (block) =>
          block.title === block.subject &&
          block.subject === block.label &&
          block.memo?.trim().length,
      ),
    ).toBe(true);

    Object.values(groupedBlocks).forEach((dateBlocks) => {
      const sortedBlocks = dateBlocks
        .slice()
        .sort(
          (left, right) =>
            minutesFromClock(left.startTime) - minutesFromClock(right.startTime),
        );

      sortedBlocks.forEach((block, index) => {
        expect(minutesBetween(block.startTime, block.endTime)).toBeGreaterThan(0);
        expect(minutesFromClock(block.endTime)).toBeLessThanOrEqual(24 * 60);

        if (index === 0) {
          return;
        }

        expect(minutesFromClock(sortedBlocks[index - 1].endTime)).toBeLessThanOrEqual(
          minutesFromClock(block.startTime),
        );
      });
    });
  });

  it('returns an empty array when distributing no weekly drafts', () => {
    expect(
      distributeWeeklyDraftBlocks({
        blocks: [],
        startDate: '2026-06-19',
        dayCount: 6,
      }),
    ).toEqual([]);
  });

  it('keeps estimated minutes when weekly drafts are converted for approval', () => {
    const englishBlocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '英語を3時間',
    });
    const theoryBlocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '計算理論を4時間',
    });
    const allBlocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '英語を3時間、計算理論を4時間、卒研を2時間',
    });

    expect(totalDraftMinutes(englishBlocks)).toBe(180);
    expect(totalDraftMinutes(theoryBlocks)).toBe(240);
    expect(totalDraftMinutes(allBlocks)).toBe(540);

    const approvedDrafts = allBlocks.map((block) =>
      createPlanDraftFromWeeklyDraftBlock(block, 'user-1'),
    );
    const approvedMinutes = approvedDrafts.reduce(
      (sum, draft) => sum + minutesBetween(draft.startTime, draft.endTime),
      0,
    );

    expect(approvedMinutes).toBe(540);
  });

  it('removes desire wording from simple weekly draft labels', () => {
    const blocks = createSimpleWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '卒研を2時間やりたい',
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      title: '卒研',
      subject: '卒研',
      label: '卒研',
    });
    expect(minutesBetween(blocks[0].startTime, blocks[0].endTime)).toBe(120);
  });

  it('detects multi-task weekly planning requests for UI routing', () => {
    expect(
      looksLikeWeeklyPlanningRequest(
        '来週、英語を3時間、計算理論を4時間、卒研を2時間やりたい',
      ),
    ).toBe(true);
    expect(looksLikeWeeklyPlanningRequest('来週、英語を３時間、数学を２時間')).toBe(true);
    expect(looksLikeWeeklyPlanningRequest('明日19時から英語を1時間')).toBe(false);
    expect(looksLikeWeeklyPlanningRequest('来週ちょっと勉強したい')).toBe(false);
  });

  it('creates a weekly-only fallback draft without normal PlanDraft parsing', () => {
    const block = createFallbackWeeklyDraftBlock({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週ちょっと勉強したい',
    });

    expect(block).toMatchObject({
      userId: 'user-1',
      date: '2026-06-19',
      startTime: '19:00',
      endTime: '20:00',
      title: '来週ちょっと勉強したい',
      subject: '学習',
      label: '学習',
      status: 'draft',
      source: 'ai',
    });
    expect('planId' in block).toBe(false);
  });

  it('returns no simple drafts for blank or unextractable input', () => {
    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: '   ',
      }),
    ).toEqual([]);

    expect(
      createSimpleWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: '来週ちょっと勉強したい',
      }),
    ).toEqual([]);
  });
});
