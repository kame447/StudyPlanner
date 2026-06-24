import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createWeeklyPlanningPendingConfig,
  parseWeeklyPlanningConditionOperations,
} from './weeklyPlanningTransforms';
import {
  blocksGroupedByDate,
  maxRunsForSameTitleInDay,
  minutesFromClock,
  plan,
  sortBlocksByStartTime,
  totalDraftMinutes,
} from './testUtils/weeklyPlanningTestHelpers';
describe('weeklyPlanningRegression', () => {
  it('places all 3300 minutes after changing to 7 days with 08:00-24:00 availability', () => {
    const sourceText =
      '来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '7日間で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
    expect(result.diagnostics).toMatchObject({
      requestedMinutes: 3300,
      placedMinutes: 3300,
      unplacedMinutes: 0,
      failureReason: 'unknown',
    });
    expect(result.diagnostics?.totalAvailableCapacity).toBeGreaterThan(3300);
  });

  it('uses available time outside preferred windows when 3300 minutes requires it', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい',
      existingPlans: [],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
    expect(
      result.blocks.some(
        (block) =>
          minutesFromClock(block.startTime) < minutesFromClock('11:00') ||
          minutesFromClock(block.endTime) > minutesFromClock('23:00'),
      ),
    ).toBe(true);
  });

  it('places 3300 minutes with 09:00 start and lunch unavailable over 7 days', () => {
    const sourceText =
      '来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    let pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });

    for (const reply of ['7日間で', '勉強開始は9時からで、お昼は13〜14時']) {
      const override = applyWeeklyPlanningConditionOverride({
        config: pendingConfig,
        text: reply,
      });
      expect(override.kind).toBe('updated');
      if (override.kind !== 'updated') return;
      pendingConfig = override.config;
    }

    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: sourceText,
      pendingConfig,
      existingPlans: [],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
    expect(result.defaults).toMatchObject({ dayCount: 7 });
    expect(result.defaults.availableStudyRanges[0]).toMatchObject({
      startTime: '09:00',
      endTime: '24:00',
    });
    expect(result.defaults.unavailableRanges).toContainEqual(
      expect.objectContaining({ startTime: '13:00', endTime: '14:00' }),
    );
  });

  it('reports existing plan conflict diagnostics when existing plans and buffers leave no room', () => {
    const existingPlans = [
      '2026-06-26',
      '2026-06-27',
      '2026-06-28',
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ].map((date, index) =>
      plan({
        id: `diagnostic-blocked-${index}`,
        date,
        startTime: '08:00',
        endTime: '24:00',
      }),
    );
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間。この条件で作成',
      existingPlans,
    });

    expect(result.blocks).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      requestedMinutes: 1200,
      placedMinutes: 0,
      failureReason: 'existing_plan_conflict',
    });
    expect(result.diagnostics?.existingPlanBlockedMinutes).toBeGreaterThan(0);
    expect(result.warnings.join('\n')).toContain('既存予定とその前後30分');
  });

  it('normalizes day-count variants into setDayCount operations', () => {
    [
      ['七日間で', 7],
      ['７日間で', 7],
      ['7日間で', 7],
      ['七日で', 7],
    ].forEach(([text, dayCount]) => {
      expect(parseWeeklyPlanningConditionOperations(String(text))).toContainEqual({
        kind: 'setDayCount',
        dayCount,
      });
    });
  });

  it('extracts all operations from the manual multiline condition reply', () => {
    expect(
      parseWeeklyPlanningConditionOperations(
        '七日間で\n睡眠は2:00~9:00\nお昼ご飯は13:00~14:00\n夜ごはんは20:00~21:00で',
      ),
    ).toEqual([
      { kind: 'setDayCount', dayCount: 7 },
      { kind: 'setSleepWindow', startTime: '02:00', endTime: '09:00' },
      {
        kind: 'addUnavailableRange',
        startTime: '13:00',
        endTime: '14:00',
        reason: '昼食',
      },
      {
        kind: 'addUnavailableRange',
        startTime: '20:00',
        endTime: '21:00',
        reason: '夕食',
      },
    ]);
  });

  it('applies all operations from the manual multiline condition reply', () => {
    const sourceText = '来週、英語を2時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '七日間で\n睡眠は2:00~9:00\nお昼ご飯は13:00~14:00\n夜ごはんは20:00~21:00で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults).toMatchObject({
      dayCount: 7,
      sleepStartTime: '02:00',
      wakeTime: '09:00',
    });
    expect(override.config.defaults.availableStudyRanges).toEqual([
      expect.objectContaining({ startTime: '09:00', endTime: '24:00' }),
    ]);
    expect(override.config.defaults.unavailableRanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startTime: '13:00',
          endTime: '14:00',
          reason: '昼食',
        }),
        expect.objectContaining({
          startTime: '20:00',
          endTime: '21:00',
          reason: '夕食',
        }),
      ]),
    );
  });

  it('classifies meal and unavailable time ranges from surrounding words', () => {
    [
      ['お昼ご飯は13:00~14:00', '昼食'],
      ['昼食は13:00~14:00', '昼食'],
      ['ランチは13:00~14:00', '昼食'],
      ['夜ごはんは20:00~21:00', '夕食'],
      ['夕食は20:00~21:00', '夕食'],
      ['13:00-14:00 は使わない', '使用不可'],
      ['20:00-21:00 は空けて', '使用不可'],
    ].forEach(([text, reason]) => {
      const operations = parseWeeklyPlanningConditionOperations(String(text));

      expect(operations).toEqual([
        expect.objectContaining({
          kind: 'addUnavailableRange',
          reason,
        }),
      ]);
    });
  });

  it('places all 3300 minutes for the manual 7-day sleep and meal condition set', () => {
    const sourceText =
      '来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '七日間で\n睡眠は2:00~9:00\nお昼ご飯は13:00~14:00\n夜ごはんは20:00~21:00で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });

    expect(result.defaults).toMatchObject({
      dayCount: 7,
      wakeTime: '09:00',
      sleepStartTime: '02:00',
    });
    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
    expect(result.diagnostics).toMatchObject({
      requestedMinutes: 3300,
      placedMinutes: 3300,
      unplacedMinutes: 0,
      totalAvailableCapacity: 5460,
      failureReason: 'unknown',
    });
    expect(result.diagnostics?.unusedAvailableMinutes).toBeGreaterThan(0);
  });

  it('does not show search-failure wording when diagnostics report no unused available minutes', () => {
    const existingPlans = [
      '2026-06-26',
      '2026-06-27',
      '2026-06-28',
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ].map((date, index) =>
      plan({
        id: `full-capacity-${index}`,
        date,
        startTime: '08:00',
        endTime: '24:00',
      }),
    );
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間。この条件で作成',
      existingPlans,
    });

    expect(result.diagnostics).toMatchObject({
      requestedMinutes: 1200,
      placedMinutes: 0,
      unplacedMinutes: 1200,
      unusedAvailableMinutes: 0,
      failureReason: 'existing_plan_conflict',
    });
    expect(result.warnings.join('\n')).not.toContain('空き時間は残っていますが');
    expect(result.warnings.join('\n')).toContain('既存予定とその前後30分');
  });

  it('keeps same-subject blocks from creating unexplained multi-hour gaps in the three-day case', () => {
    const sourceText = '来週、卒研2時間、英語3時間、計算理論4時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '3日間でやって',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: 'この条件で作成',
      pendingConfig: override.config,
    });

    Object.values(blocksGroupedByDate(result.blocks)).forEach((dateBlocks) => {
      const byTitle = new Map<string, typeof dateBlocks>();
      dateBlocks.forEach((block) => {
        byTitle.set(block.title, [...(byTitle.get(block.title) ?? []), block]);
      });
      byTitle.forEach((titleBlocks) => {
        const sorted = sortBlocksByStartTime(titleBlocks);
        sorted.slice(1).forEach((block, index) => {
          const previous = sorted[index];
          const gapMinutes = minutesFromClock(block.startTime) - minutesFromClock(previous.endTime);
          expect(gapMinutes).toBeLessThanOrEqual(120);
        });
      });
    });
  });

  it('keeps same-day subject reentry bounded for larger weekly plans', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語10時間、数学8時間、卒研6時間やりたい。この条件で作成',
    });

    Object.values(blocksGroupedByDate(result.blocks)).forEach((dateBlocks) => {
      expect(maxRunsForSameTitleInDay(dateBlocks)).toBeLessThanOrEqual(2);
    });
  });
});
