import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createWeeklyPlanningPendingConfig,
} from '../weeklyPlanningTransforms';
const SELECTED_DATE = '2026-06-19';
import {
  averageStartMinutesByDateForTitle,
  blocksGroupedByDate,
  countSameDaySubjectFragmentations,
  countSubjectSwitches,
  expectBlocksSortedByDateAndStartTime,
  hasOverlapWithExistingPlans,
  lateMinutesForTitles,
  maxRunsForSameTitleInDay,
  minutesBetween,
  minutesFromClock,
  plan,
  totalDraftMinutes,
  totalsByTitle,
} from '../testUtils/weeklyPlanningTestHelpers';
describe('scheduling placementScoring', () => {
  it('asks for confirmation before creating availability-aware weekly drafts', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間やりたい',
    });

    expect(assessment.kind).toBe('needs_confirmation');
    expect(assessment.tasks.map((task) => task.title)).toEqual([
      '英語',
      '計算理論',
    ]);
    expect(assessment.confirmationSummary).toContain('既存予定前後30分');
    expect(assessment.confirmationSummary).toContain('予備日');
  });

  it('uses day-first session chunks for availability-aware default task splitting', () => {
    [
      ['\u82f1\u8a9e\u30923\u6642\u9593', [60, 60, 60]],
      ['\u82f1\u8a9e\u30924\u6642\u9593', [60, 60, 60, 60]],
      ['\u82f1\u8a9e\u30925\u6642\u9593', [60, 60, 60, 60, 60]],
    ].forEach(([taskText, expectedChunks]) => {
      const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: `\u6765\u9031\u3001${taskText}\u3084\u308a\u305f\u3044`,
        existingPlans: [],
      });

      expect(result.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual(
        expectedChunks,
      );
    });
  });

  it('does not mass-produce thirty-minute chunks for heavy default tasks', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、計算理論を5時間。この条件で作成',
      existingPlans: [],
    });
    const thirtyMinuteChunks = result.blocks.filter(
      (block) => minutesBetween(block.startTime, block.endTime) < 40,
    );

    expect(result.unplacedMinutes).toBe(0);
    expect(result.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      60,
      60,
      60,
      60,
      60,
    ]);
    expect(thirtyMinuteChunks).toHaveLength(0);
  });

  it('spreads a lightweight three-day weekly plan before chunking', () => {
    const sourceText = '\u6765\u9031\u3001\u82f1\u8a9e\u30923\u6642\u9593\u3001\u8a08\u7b97\u7406\u8ad6\u30924\u6642\u9593\u3001\u5352\u7814\u30922\u6642\u9593\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '3\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });
    const datesByTitle = result.blocks.reduce<Record<string, Set<string>>>(
      (groups, block) => {
        groups[block.title] = groups[block.title] ?? new Set<string>();
        groups[block.title].add(block.date);
        return groups;
      },
      {},
    );
    const dailyTitleCounts = Object.values(blocksGroupedByDate(result.blocks)).map(
      (dateBlocks) => new Set(dateBlocks.map((block) => block.title)).size,
    );
    const dailyTotals = Object.values(blocksGroupedByDate(result.blocks)).map(
      (dateBlocks) => totalDraftMinutes(dateBlocks),
    );
    const durations = result.blocks.map((block) =>
      minutesBetween(block.startTime, block.endTime),
    );

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(540);
    expect(new Set(result.blocks.map((block) => block.date)).size).toBe(3);
    expect(datesByTitle['\u82f1\u8a9e'].size).toBeGreaterThan(1);
    expect(datesByTitle['\u8a08\u7b97\u7406\u8ad6'].size).toBeGreaterThan(1);
    expect(durations.some((duration) => duration > 0 && duration < 40)).toBe(false);
    expect(durations).not.toEqual(expect.arrayContaining([90, 30]));
    expect(dailyTitleCounts.every((count) => count > 1)).toBe(true);
    expect(Math.max(...dailyTotals) - Math.min(...dailyTotals)).toBeLessThanOrEqual(90);
    expect(result.diagnostics?.placementQuality).toMatchObject({
      tinyChunkPenalty: 0,
      sameTaskClumpingPenalty: 0,
      compactness: 0,
    });
    expect(result.diagnostics?.sessionEvaluations?.length).toBe(result.blocks.length);
    expect(
      result.diagnostics?.sessionEvaluations?.every((evaluation) => evaluation.selected),
    ).toBe(true);
  });

  it('keeps same-day subjects grouped while preserving day-level spread', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: '来週、英語10時間、数学8時間、卒研6時間やりたい。この条件で作成',
      existingPlans: [],
    });
    const groupedBlocks = blocksGroupedByDate(result.blocks);
    const durations = result.blocks.map((block) =>
      minutesBetween(block.startTime, block.endTime),
    );

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(1440);
    expect(new Set(result.blocks.map((block) => block.date)).size).toBe(6);
    expect(durations.some((duration) => duration > 0 && duration < 40)).toBe(false);
    expect(
      Object.values(groupedBlocks).every(
        (dateBlocks) => new Set(dateBlocks.map((block) => block.title)).size > 1,
      ),
    ).toBe(true);
    expect(
      Object.values(groupedBlocks).every((dateBlocks) =>
        maxRunsForSameTitleInDay(dateBlocks) < 3,
      ),
    ).toBe(true);
    expect(
      Object.values(groupedBlocks).every((dateBlocks) =>
        countSameDaySubjectFragmentations(dateBlocks) <= 1,
      ),
    ).toBe(true);
    expect(
      Object.values(groupedBlocks).every((dateBlocks) =>
        countSubjectSwitches(dateBlocks) <= Math.max(2, new Set(dateBlocks.map((block) => block.title)).size),
      ),
    ).toBe(true);
  });

  it('keeps each subject near a stable time band across days', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: '来週、英語10時間、数学8時間、卒研6時間やりたい。この条件で作成',
      existingPlans: [],
    });

    ['英語', '数学', '卒研'].forEach((title) => {
      const averages = averageStartMinutesByDateForTitle(result.blocks, title);

      expect(averages.length).toBeGreaterThan(1);
      expect(Math.max(...averages) - Math.min(...averages)).toBeLessThanOrEqual(180);
    });
  });

  it('keeps heavy tasks from being overrepresented after 22:00', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: '来週、卒研6時間、Java実装6時間、英語4時間やりたい。この条件で作成',
      existingPlans: [],
    });
    const heavyLateMinutes = lateMinutesForTitles(result.blocks, /卒研|Java実装/);
    const englishLateMinutes = lateMinutesForTitles(result.blocks, /英語/);

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(960);
    expect(heavyLateMinutes).toBeLessThanOrEqual(60);
    expect(heavyLateMinutes).toBeLessThanOrEqual(englishLateMinutes + 60);
  });

  it('keeps same-day placement compact after a blocking interval clears', () => {
    const sourceText = '\u6765\u9031\u3001\u82f1\u8a9e1\u6642\u9593\u3001\u8a08\u7b97\u7406\u8ad61\u6642\u9593\u3001\u5352\u78141\u6642\u9593\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '1\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });
    const sortedBlocks = result.blocks
      .slice()
      .sort(
        (left, right) =>
          minutesFromClock(left.startTime) - minutesFromClock(right.startTime),
      );

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(180);
    expect(sortedBlocks).toHaveLength(3);
    expect(minutesFromClock(sortedBlocks[2].startTime)).toBe(
      minutesFromClock(sortedBlocks[1].endTime) + result.defaults.breakMinutes,
    );
    expect(minutesFromClock(sortedBlocks[2].startTime)).toBeLessThan(
      minutesFromClock('17:00'),
    );
    expect(result.diagnostics?.placementQuality?.compactness).toBe(0);
  });

  it('persists follow-up long-session intent in pending config and placement scoring', () => {
    const sourceText = '\u6765\u9031\u3001\u82f1\u8a9e3\u6642\u9593\u3001\u8a08\u7b97\u7406\u8ad64\u30924\u6642\u9593\u3001\u5352\u78142\u6642\u9593\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    let pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '\u9577\u3081\u3067',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.messages).toContain('長めのセッションを優先する設定に変更しました。');
    pendingConfig = override.config;
    expect(pendingConfig.sessionIntentOverrides).toContainEqual(
      expect.objectContaining({ scope: 'global', kind: 'prefer_long' }),
    );
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig,
      existingPlans: [],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(result.diagnostics?.placementQuality?.explicitIntentOverride).toBe(true);
    expect(
      result.diagnostics?.sessionEvaluations?.some(
        (evaluation) =>
          (evaluation.selected?.components.explicitOverrideBonus ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it('rounds day quotas to natural planning units while preserving total minutes', () => {
    const sourceText = '\u6765\u9031\u3001\u82f1\u8a9e\u3092200\u5206\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '3\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });
    const durations = result.blocks.map((block) =>
      minutesBetween(block.startTime, block.endTime),
    );

    expect(totalDraftMinutes(result.blocks)).toBe(200);
    expect(durations).not.toEqual([67, 67, 66]);
    expect(durations.every((duration) => duration % 5 === 0)).toBe(true);
  });

  it('keeps total minutes when no non-tiny heavy chunk candidate exists', () => {
    const sourceText = '\u6765\u9031\u3001\u5352\u7814\u3092100\u5206\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    let pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const dayOverride = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '1\u65e5\u9593\u3067\u3084\u3063\u3066',
    });
    expect(dayOverride.kind).toBe('updated');
    if (dayOverride.kind !== 'updated') return;
    pendingConfig = dayOverride.config;
    const maxOverride = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '1\u56de90\u5206\u3067',
    });
    expect(maxOverride.kind).toBe('updated');
    if (maxOverride.kind !== 'updated') return;

    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: maxOverride.config,
      existingPlans: [],
    });

    expect(totalDraftMinutes(result.blocks)).toBe(100);
    expect(result.unplacedMinutes).toBe(0);
    expect(
      result.diagnostics?.tinyChunkViolations?.some(
        (violation) =>
          violation.title === '\u5352\u7814' &&
          !violation.allowed &&
          violation.durationMinutes > 0 &&
          violation.durationMinutes < 60,
      ),
    ).toBe(true);
  });

  it('classifies gaps caused by existing plans or buffers', () => {
    const sourceText = '\u6765\u9031\u3001\u82f1\u8a9e1\u6642\u9593\u3001\u8a08\u7b97\u7406\u8ad61\u6642\u9593\u3001\u5352\u78141\u6642\u9593\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '1\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [
        plan({
          id: 'midday-existing-plan',
          date: '2026-06-30',
          startTime: '15:00',
          endTime: '15:30',
        }),
      ],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(
      result.diagnostics?.gapReasons?.some(
        (gap) => gap.reason === 'existing_plan' || gap.reason === 'existing_plan_buffer',
      ),
    ).toBe(true);
    expect(result.diagnostics?.gapReasons?.some((gap) => gap.reason === 'unexplained_gap')).toBe(false);
  });

  it('falls back from preferredDate without dropping sessions and records diagnostics', () => {
    const sourceText = '\u6765\u9031\u3001\u82f1\u8a9e3\u6642\u9593\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '3\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [
        plan({
          id: 'blocks-first-preferred-date',
          date: '2026-06-30',
          startTime: '08:00',
          endTime: '24:00',
        }),
      ],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(180);
    expect(result.diagnostics?.fallbackPlacements?.length).toBeGreaterThan(0);
    expect(result.diagnostics?.fallbackPlacements?.[0]).toMatchObject({
      title: '\u82f1\u8a9e',
      preferredDate: '2026-06-30',
    });
  });

  it('keeps default 120 minute tasks away from 90 plus 30 while allowing explicit two-hour blocks', () => {
    const sourceText = '\u6765\u9031\u3001\u5352\u7814\u30922\u6642\u9593\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '3\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const defaultResult = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });
    const explicitText = '\u6765\u9031\u3001\u5352\u7814\u30922\u6642\u9593\u30012\u6642\u9593\u5358\u4f4d\u3067\u3084\u308a\u305f\u3044';
    const explicitAssessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: explicitText,
    });
    const explicitPendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: explicitText,
      assessment: explicitAssessment,
    });
    const explicitOverride = applyWeeklyPlanningConditionOverride({
      config: explicitPendingConfig,
      text: '3\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(defaultResult.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      60,
      60,
    ]);
    expect(explicitOverride.kind).toBe('updated');
    if (explicitOverride.kind !== 'updated') return;
    const explicitResult = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: explicitText,
      pendingConfig: explicitOverride.config,
      existingPlans: [],
    });

    expect(explicitResult.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      120,
    ]);
  });

  it('switches only explicit one-shot tasks to compact placement', () => {
    const sourceText = '\u6765\u9031\u3001\u5352\u7814\u30922\u6642\u9593\u3092\u5148\u306b\u4e00\u6c17\u306b\u7247\u3065\u3051\u305f\u3044\u3001\u82f1\u8a9e\u30923\u6642\u9593\u3001\u8a08\u7b97\u7406\u8ad6\u30924\u6642\u9593\u3082\u3084\u308a\u305f\u3044';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-23',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '3\u65e5\u9593\u3067\u3084\u3063\u3066',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-23',
      text: sourceText,
      pendingConfig: override.config,
      existingPlans: [],
    });
    const datesByTitle = result.blocks.reduce<Record<string, Set<string>>>(
      (groups, block) => {
        groups[block.title] = groups[block.title] ?? new Set<string>();
        groups[block.title].add(block.date);
        return groups;
      },
      {},
    );

    expect(totalDraftMinutes(result.blocks)).toBe(540);
    expect(datesByTitle['\u5352\u7814'].size).toBe(1);
    expect(datesByTitle['\u82f1\u8a9e'].size).toBeGreaterThan(1);
    expect(datesByTitle['\u8a08\u7b97\u7406\u8ad6'].size).toBeGreaterThan(1);
    expect(result.diagnostics?.placementQuality?.explicitIntentOverride).toBe(true);
  });

  it('keeps 55 hours and all task names in availability-aware placement', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間、線形代数を8時間、確率統計を6時間、卒研を8時間、Java実装を6時間、レポート作成を4時間、Obsidian整理を3時間やりたい',
      existingPlans: [],
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
    expect(totalsByTitle(result.blocks)).toEqual({
      英語: 600,
      計算理論: 600,
      線形代数: 480,
      確率統計: 360,
      卒研: 480,
      Java実装: 360,
      レポート作成: 240,
      Obsidian整理: 180,
    });
    expect(
      result.blocks.every(
        (block) => block.date >= '2026-06-26' && block.date <= '2026-07-01',
      ),
    ).toBe(true);
    expectBlocksSortedByDateAndStartTime(result.blocks);
  });

  it('avoids existing plans with the default 30 minute buffer', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を4時間、計算理論を4時間やりたい',
      existingPlans: [
        plan({
          date: '2026-06-26',
          startTime: '10:00',
          endTime: '11:00',
        }),
      ],
    });
    const blockedStart = minutesFromClock('09:30');
    const blockedEnd = minutesFromClock('11:30');

    result.blocks
      .filter((block) => block.date === '2026-06-26')
      .forEach((block) => {
        expect(
          minutesFromClock(block.startTime) < blockedEnd &&
            blockedStart < minutesFromClock(block.endTime),
        ).toBe(false);
      });
    expect(totalDraftMinutes(result.blocks)).toBe(480);
  });

  it('does not use deep-night time without user permission', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を3時間、計算理論を3時間やりたい',
      existingPlans: [],
    });

    expect(
      result.blocks.every((block) => minutesFromClock(block.startTime) >= 8 * 60),
    ).toBe(true);
    expect(result.blocks.every((block) => minutesFromClock(block.endTime) <= 24 * 60)).toBe(
      true,
    );
  });

  it('prefers default focus windows before ordinary morning slots', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '\u6765\u9031\u3001\u82f1\u8a9e\u30922\u6642\u9593\u3084\u308a\u305f\u3044',
      existingPlans: [],
    });

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(totalDraftMinutes(result.blocks)).toBe(120);
    expect(
      result.blocks.every(
        (block) =>
          minutesBetween(block.startTime, block.endTime) <=
          result.defaults.maxSessionMinutes,
      ),
    ).toBe(true);
    result.blocks.forEach((block) => {
      expect(block.title).toBe('\u82f1\u8a9e');
      expect(block.date >= '2026-06-26' && block.date <= '2026-07-01').toBe(true);
      expect(minutesFromClock(block.startTime)).toBeGreaterThanOrEqual(
        minutesFromClock('11:00'),
      );
      expect(minutesFromClock(block.endTime)).toBeLessThanOrEqual(
        minutesFromClock('18:00'),
      );
    });
  });

  it('keeps a break between generated sessions on the same day', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間、線形代数を8時間、確率統計を6時間、卒研を8時間、Java実装を6時間、レポート作成を4時間、Obsidian整理を3時間やりたい',
      existingPlans: [],
    });
    const groupedBlocks = blocksGroupedByDate(result.blocks);

    Object.values(groupedBlocks).forEach((dateBlocks) => {
      const sortedBlocks = dateBlocks
        .slice()
        .sort(
          (left, right) =>
            minutesFromClock(left.startTime) - minutesFromClock(right.startTime),
        );

      sortedBlocks.forEach((block, index) => {
        if (index === 0) {
          return;
        }

        expect(minutesFromClock(block.startTime)).toBeGreaterThanOrEqual(
          minutesFromClock(sortedBlocks[index - 1].endTime) + 10,
        );
      });
    });
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
  });

  it('absorbs too-short session remainders instead of creating tiny blocks', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を2.1時間やりたい',
      existingPlans: [],
    });

    expect(totalDraftMinutes(result.blocks)).toBe(126);
    expect(result.blocks.length).toBeGreaterThanOrEqual(2);
    expect(
      result.blocks.every(
        (block) =>
          minutesBetween(block.startTime, block.endTime) >= 30 &&
          minutesBetween(block.startTime, block.endTime) <= result.defaults.maxSessionMinutes,
      ),
    ).toBe(true);
    expect(
      result.blocks.some(
        (block) => minutesBetween(block.startTime, block.endTime) > 0 && minutesBetween(block.startTime, block.endTime) < 30,
      ),
    ).toBe(false);
  });

  it('places high-priority or deadline tasks earlier and keeps planning metadata in memo', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '\u6765\u9031\u3001\u82f1\u8a9e\u30922\u6642\u9593\u30016/30\u307e\u3067\u306b\u91cd\u8981\u306a\u30ec\u30dd\u30fc\u30c8\u4f5c\u6210\u30922\u6642\u9593\u3084\u308a\u305f\u3044',
      existingPlans: [],
    });
    const reportBlocks = result.blocks.filter((block) => block.title === '\u30ec\u30dd\u30fc\u30c8\u4f5c\u6210');
    const reportBlock = reportBlocks[0];
    const englishBlock = result.blocks.find((block) => block.title === '\u82f1\u8a9e');

    expect(reportBlock).toBeDefined();
    expect(englishBlock).toBeDefined();
    expect(reportBlock?.date.localeCompare(englishBlock?.date ?? '')).toBeLessThanOrEqual(
      0,
    );
    expect(reportBlock?.memo).toContain('\u512a\u5148\u5ea6: \u9ad8');
    expect(reportBlock?.memo).toContain('\u7de0\u5207: 2026-06-30');
    expect(reportBlock?.memo).toContain('\u5bfe\u8c61\u9031: 2026-06-26\u301c2026-07-02');
    expect(reportBlock?.memo).toContain('\u4e88\u5099\u65e5: 2026-07-02');
    expect(
      reportBlocks.reduce(
        (total, block) => total + minutesBetween(block.startTime, block.endTime),
        0,
      ),
    ).toBe(120);
  });

  it('requires explicit create confirmation after defaults are proposed', () => {
    const omakaseAssessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間、数学を2時間。おまかせ',
      hasPendingConfirmation: true,
      confirmationText: 'おまかせ',
    });
    const confirmedAssessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間、数学を2時間。おまかせ。この条件で作成',
      hasPendingConfirmation: true,
      confirmationText: 'この条件で作成',
    });

    expect(omakaseAssessment.kind).toBe('needs_confirmation');
    expect(omakaseAssessment.confirmationSummary).toContain('勉強可能時間');
    expect(omakaseAssessment.questions.join('\n')).toContain('この条件で作成');
    expect(confirmedAssessment.kind).toBe('ready');
  });

  it('reports unplaced minutes instead of reducing requested study time when the week is full', () => {
    const existingPlans = Array.from({ length: 6 }, (_, index) =>
      plan({
        id: `blocked-${index}`,
        date: `2026-06-${26 + index}`,
        startTime: '08:00',
        endTime: '24:00',
      }),
    );
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間、線形代数を8時間、確率統計を6時間、卒研を8時間、Java実装を6時間、レポート作成を4時間、Obsidian整理を3時間。この条件で作成',
      existingPlans,
    });

    expect(totalDraftMinutes(result.blocks) + result.unplacedMinutes).toBe(3300);
    expect(result.unplacedMinutes).toBeGreaterThan(0);
    expect(result.blocks).toEqual([]);
    expect(result.warnings.join('\n')).toContain('配置でき');
    expect(result.warnings.join('\n')).toContain('配置できる分だけでいい');
  });

  it('does not retry forever when a blocked session cannot split without a tiny remainder', () => {
    const existingPlans = [
      '2026-06-26',
      '2026-06-27',
      '2026-06-28',
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ].map((date, index) =>
      plan({
        id: `blocked-remainder-${index}`,
        date,
        startTime: '08:00',
        endTime: '24:00',
      }),
    );
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '\u6765\u9031\u3001\u82f1\u8a9e\u309275\u5206\u3002\u3053\u306e\u6761\u4ef6\u3067\u4f5c\u6210',
      existingPlans,
    });

    expect(result.blocks).toEqual([]);
    expect(result.unplacedMinutes).toBe(75);
    expect(result.diagnostics?.failureReason).toBe('existing_plan_conflict');
  });

  it('creates partial drafts only when explicitly allowed', () => {
    const existingPlans = Array.from({ length: 6 }, (_, index) =>
      plan({
        id: `partial-${index}`,
        date: `2026-06-${26 + index}`,
        startTime: '08:00',
        endTime: '23:00',
      }),
    );
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を10時間、計算理論を10時間。この条件で作成',
      existingPlans,
      allowPartialPlacement: true,
    });

    expect(result.placedMinutes).toBeGreaterThan(0);
    expect(result.unplacedMinutes).toBeGreaterThan(0);
    expect(totalDraftMinutes(result.blocks)).toBe(result.placedMinutes);
  });

  it('uses policy-based 60 minute chunks instead of relying on retry for a cramped 120 minute task', () => {
    const existingPlans = [
      plan({
        id: 'busy-morning',
        date: '2026-06-26',
        startTime: '08:00',
        endTime: '11:00',
      }),
      plan({
        id: 'busy-late',
        date: '2026-06-26',
        startTime: '13:10',
        endTime: '24:00',
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        plan({
          id: `full-${index}`,
          date: `2026-06-${27 + index}`,
          startTime: '08:00',
          endTime: '24:00',
        }),
      ),
    ];
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間。この条件で作成',
      existingPlans,
      allowPartialPlacement: true,
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(result.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      60,
      60,
    ]);
  });

  it('avoids creating a 30 minute retry chunk when day-first 60 minute chunks fit', () => {
    const existingPlans = [
      plan({
        id: 'busy-early',
        date: '2026-06-26',
        startTime: '08:00',
        endTime: '11:00',
      }),
      plan({
        id: 'busy-late',
        date: '2026-06-26',
        startTime: '14:10',
        endTime: '24:00',
      }),
      ...Array.from({ length: 5 }, (_, index) =>
        plan({
          id: `full-reuse-${index}`,
          date: `2026-06-${27 + index}`,
          startTime: '08:00',
          endTime: '24:00',
        }),
      ),
    ];
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '\u6765\u9031\u3001\u82f1\u8a9e\u30923\u6642\u9593\u3002\u3053\u306e\u6761\u4ef6\u3067\u4f5c\u6210',
      existingPlans,
      allowPartialPlacement: true,
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(result.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      60,
      60,
      60,
    ]);
    expect(result.blocks.every((block) => minutesBetween(block.startTime, block.endTime) >= 60)).toBe(true);
  });

  it('allows deep-night placement only when explicitly permitted', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を1時間やりたい。深夜OKでおまかせ',
      existingPlans: [
        plan({
          date: '2026-06-26',
          startTime: '08:00',
          endTime: '23:30',
        }),
      ],
    });

    expect(result.blocks).toHaveLength(1);
    expect(minutesFromClock(result.blocks[0].startTime)).toBeLessThan(8 * 60);
  });


  it('treats active timetable templates as existing busy intervals for weekly planning', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '来週、英語150分やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語150分やりたい',
      assessment,
    });
    const defaults = {
      ...pendingConfig.defaults,
      dayCount: 1,
      reserveDate: '2026-06-30',
      bufferMinutes: 30,
      availableStudyRanges: [
        { startTime: '09:00', endTime: '13:00', reason: 'test available' },
      ],
      preferredStudyRanges: [
        { startTime: '09:00', endTime: '13:00', reason: 'test preferred' },
      ],
      unavailableRanges: [],
    };
    const scheduleTemplates = [
      {
        id: 'template-mon-2',
        userId: 'user-1',
        title: '計算理論',
        subject: '計算理論',
        type: 'school-event' as const,
        weekday: 'tue' as const,
        startTime: '10:20',
        endTime: '11:50',
        termId: 'term-1',
        periodNumber: 2,
        classroom: 'A101',
        memo: '',
        active: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ];
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: SELECTED_DATE,
      text: 'この条件で作成',
      scheduleTemplates,
      timetableTermId: 'term-1',
      allowPartialPlacement: true,
      pendingConfig: { ...pendingConfig, defaults },
    });

    expect(result.placedMinutes + result.unplacedMinutes).toBe(150);
    expect(result.unplacedMinutes).toBeGreaterThan(0);
    expect(result.blocks.some((block) => {
      const startMinutes = minutesFromClock(block.startTime);
      const endMinutes = minutesFromClock(block.endTime);
      return block.date === defaults.startDate && startMinutes < 12 * 60 + 20 && endMinutes > 9 * 60 + 50;
    })).toBe(false);
    expect(result.diagnostics?.hardViolationCount).toBe(0);
  });
  it('keeps minutes unplaced instead of violating existing plan buffers', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: SELECTED_DATE,
      text: '来週、英語150分やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語150分やりたい',
      assessment,
    });
    const defaults = {
      ...pendingConfig.defaults,
      dayCount: 1,
      reserveDate: '2026-06-30',
      bufferMinutes: 30,
      availableStudyRanges: [
        { startTime: '09:00', endTime: '13:00', reason: 'test available' },
      ],
      preferredStudyRanges: [
        { startTime: '09:00', endTime: '13:00', reason: 'test preferred' },
      ],
      unavailableRanges: [],
    };
    const existingPlans = [
      plan({ date: defaults.startDate, startTime: '10:20', endTime: '11:50' }),
    ];
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: SELECTED_DATE,
      text: 'この条件で作成',
      existingPlans,
      allowPartialPlacement: true,
      pendingConfig: { ...pendingConfig, defaults },
    });

    expect(result.placedMinutes + result.unplacedMinutes).toBe(150);
    expect(result.unplacedMinutes).toBeGreaterThan(0);
    expect(hasOverlapWithExistingPlans(result.blocks, existingPlans, defaults.bufferMinutes)).toBe(false);
    expect(result.diagnostics?.hardViolationCount).toBe(0);
  });
});
