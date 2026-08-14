import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createFallbackWeeklyDraftBlock,
  createPlanDraftFromWeeklyDraftBlock,
  createSimpleWeeklyDraftBlocksFromText,
  createWeeklyDraftBlockFromPlanDraft,
  createWeeklyPlanningPendingConfig,
  distributeWeeklyDraftBlocks,
  mergeWeeklyPlanningRevision,
  parseWeeklyPlanningConditionOperations,
  looksLikeWeeklyPlanningRequest,
} from './weeklyPlanningTransforms';
import {
  blocksGroupedByDate,
  expectBlocksSortedByDateAndStartTime,
  minutesBetween,
  minutesFromClock,
  planDraft,
  totalDraftMinutes,
  totalsByTitle,
} from './testUtils/weeklyPlanningTestHelpers';
describe('weeklyPlanningTransforms.integration', () => {
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

  it('updates pending weekly planning day count with a fixed day-count reply', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語を2時間やりたい',
      assessment,
    });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '7日間で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.dayCount).toBe(7);
    expect(override.config.defaults.reserveDate).toBe('2026-07-03');
  });

  it('includes the reserve date in placement when the user says to use it', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語を2時間やりたい',
      assessment,
    });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '予備日も使って',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.dayCount).toBe(7);
    expect(override.config.defaults.reserveDate).toBe('2026-07-03');
  });

  it('updates pending weekly planning available windows from a fixed time range', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語を2時間やりたい',
      assessment,
    });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '13時から22時で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.availableStudyRanges).toEqual([
      expect.objectContaining({ startTime: '13:00', endTime: '22:00' }),
    ]);
    expect(override.config.defaults.preferredStudyRanges).toEqual([
      expect.objectContaining({ startTime: '13:00', endTime: '22:00' }),
    ]);
  });

  it('updates pending weekly planning max session minutes', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語を2時間やりたい',
      assessment,
    });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '1回90分で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.maxSessionMinutes).toBe(90);
  });

  it('updates pending weekly planning break minutes', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語を2時間やりたい',
      assessment,
    });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '休憩15分で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.breakMinutes).toBe(15);
  });

  it('updates pending weekly planning sleep window', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい',
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({
      sourceText: '来週、英語を2時間やりたい',
      assessment,
    });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '睡眠は2時から9時',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults).toMatchObject({
      sleepStartTime: '02:00',
      wakeTime: '09:00',
    });
    expect(override.config.defaults.availableStudyRanges).toEqual([
      expect.objectContaining({ startTime: '09:00', endTime: '24:00' }),
    ]);
  });

  it('creates drafts from updated pending conditions instead of default conditions', () => {
    const sourceText =
      '来週、英語10時間、計算理論10時間、線形代数8時間、確率統計6時間、卒研8時間、Java実装6時間、レポート作成4時間、Obsidian整理3時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    let pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });

    for (const reply of ['7日間で', '1回90分で', '9時から24時で']) {
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

    expect(result.defaults).toMatchObject({ dayCount: 7, maxSessionMinutes: 90 });
    expect(result.unplacedMinutes).toBe(0);
    expect(totalDraftMinutes(result.blocks)).toBe(3300);
    expect(
      result.blocks.every(
        (block) =>
          minutesBetween(block.startTime, block.endTime) <= 90 &&
          minutesFromClock(block.startTime) >= minutesFromClock('09:00') &&
          minutesFromClock(block.endTime) <= minutesFromClock('24:00'),
      ),
    ).toBe(true);
  });

  it('does not treat short condition replies as weekly planning requests without pending state', () => {
    ['7日間で', '1回90分で', '13時から22時で', '休憩15分で'].forEach((reply) => {
      expect(looksLikeWeeklyPlanningRequest(reply)).toBe(false);
      expect(
        assessWeeklyPlanningRequest({
          selectedDate: '2026-06-19',
          text: reply,
        }).kind,
      ).toBe('needs_task_details');
    });
  });

  it('merges weekly planning revisions and recomputes from the full updated task set', () => {
    const revision = mergeWeeklyPlanningRevision({
      selectedDate: '2026-06-19',
      previousText: '来週、英語を10時間、数学を8時間。11:00〜18:00中心、最大90分、休憩15分',
      revisionText: '数学を12時間にして、英単語を毎日50語追加',
    });

    expect(revision.tasks.map((task) => [task.title, task.durationMinutes])).toEqual([
      ['英語', 600],
      ['数学', 720],
      ['英単語', 0],
    ]);
    expect(revision.tasks.find((task) => task.title === '英単語')?.amount).toEqual(
      expect.objectContaining({ unit: 'words', value: 50, daily: true }),
    );
    expect(revision.defaults).toMatchObject({
      maxSessionMinutes: 90,
      breakMinutes: 15,
    });
    expect(revision.kind).toBe('needs_time_estimate');
  });

  it('respects explicit max session and wake/sleep settings during placement', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を3時間やりたい。7時起床、23時就寝、最大90分、休憩15分でおまかせ',
      existingPlans: [],
    });

    expect(totalDraftMinutes(result.blocks)).toBe(180);
    expect(result.blocks.length).toBeGreaterThanOrEqual(2);
    expect(
      result.blocks.every(
        (block) =>
          minutesBetween(block.startTime, block.endTime) >= result.defaults.minStudyBlockMinutes &&
          minutesBetween(block.startTime, block.endTime) <= 90,
      ),
    ).toBe(true);
    expect(
      result.blocks.some(
        (block) => minutesBetween(block.startTime, block.endTime) > 0 && minutesBetween(block.startTime, block.endTime) < 30,
      ),
    ).toBe(false);
    expect(
      result.blocks.every(
        (block) =>
          minutesFromClock(block.startTime) >= minutesFromClock('07:00') &&
          minutesFromClock(block.endTime) <= minutesFromClock('23:00'),
      ),
    ).toBe(true);
  });

  it('parses natural weekly condition replies into operations', () => {
    expect(parseWeeklyPlanningConditionOperations('勉強開始9時から')).toEqual([
      { kind: 'setAvailableStartTime', startTime: '09:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('勉強開始は9時からで')).toEqual([
      { kind: 'setAvailableStartTime', startTime: '09:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('勉強可能時間9時から')).toEqual([
      { kind: 'setAvailableStartTime', startTime: '09:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('9時から勉強できる')).toEqual([
      { kind: 'setAvailableStartTime', startTime: '09:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('朝は9時から使える')).toEqual([
      { kind: 'setAvailableStartTime', startTime: '09:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('22時までで')).toEqual([
      { kind: 'setAvailableEndTime', endTime: '22:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('勉強は22時まで')).toEqual([
      { kind: 'setAvailableEndTime', endTime: '22:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('夜は23時まで')).toEqual([
      { kind: 'setAvailableEndTime', endTime: '23:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('9時から22時で')).toEqual([
      { kind: 'setAvailableRange', startTime: '09:00', endTime: '22:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('勉強可能時間は9時から22時')).toEqual([
      { kind: 'setAvailableRange', startTime: '09:00', endTime: '22:00' },
    ]);
    expect(parseWeeklyPlanningConditionOperations('お昼は13〜14時')).toEqual([
      {
        kind: 'addUnavailableRange',
        startTime: '13:00',
        endTime: '14:00',
        reason: '昼食',
      },
    ]);
    expect(parseWeeklyPlanningConditionOperations('昼休みは13時から14時')).toEqual([
      {
        kind: 'addUnavailableRange',
        startTime: '13:00',
        endTime: '14:00',
        reason: '昼食',
      },
    ]);
    expect(parseWeeklyPlanningConditionOperations('13時から14時は使わない')).toEqual([
      {
        kind: 'addUnavailableRange',
        startTime: '13:00',
        endTime: '14:00',
        reason: '使用不可',
      },
    ]);
    expect(parseWeeklyPlanningConditionOperations('13-14は空けて')).toEqual([
      {
        kind: 'addUnavailableRange',
        startTime: '13:00',
        endTime: '14:00',
        reason: '使用不可',
      },
    ]);
    expect(parseWeeklyPlanningConditionOperations('夕食は18時から19時')).toEqual([
      {
        kind: 'addUnavailableRange',
        startTime: '18:00',
        endTime: '19:00',
        reason: '夕食',
      },
    ]);
  });

  it('applies compound weekly condition replies without resetting pending config', () => {
    const sourceText = '来週、英語を2時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    let pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const firstOverride = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '勉強開始は9時からで、お昼は13〜14時',
    });

    expect(firstOverride.kind).toBe('updated');
    if (firstOverride.kind !== 'updated') return;
    pendingConfig = firstOverride.config;
    expect(pendingConfig.defaults.availableStudyRanges[0]).toMatchObject({
      startTime: '09:00',
      endTime: '24:00',
    });
    expect(pendingConfig.defaults.unavailableRanges).toContainEqual(
      expect.objectContaining({
        startTime: '13:00',
        endTime: '14:00',
        reason: '昼食',
      }),
    );

    const secondOverride = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '7日間で、1回90分、休憩15分',
    });

    expect(secondOverride.kind).toBe('updated');
    if (secondOverride.kind !== 'updated') return;
    expect(secondOverride.config.defaults).toMatchObject({
      dayCount: 7,
      maxSessionMinutes: 90,
      breakMinutes: 15,
    });
    expect(secondOverride.config.defaults.availableStudyRanges[0]).toMatchObject({
      startTime: '09:00',
      endTime: '24:00',
    });
  });
});
