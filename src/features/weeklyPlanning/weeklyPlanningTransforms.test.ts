import { describe, expect, it } from 'vitest';
import type { Plan, PlanDraft } from '../../types/domain';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createFallbackWeeklyDraftBlock,
  deriveSessionLengthPolicy,
  createPlanDraftFromWeeklyDraftBlock,
  createSimpleWeeklyDraftBlocksFromText,
  createWeeklyDraftBlockFromPlanDraft,
  createWeeklyPlanningPendingConfig,
  distributeWeeklyDraftBlocks,
  inferStudyTaskProfile,
  mergeWeeklyPlanningRevision,
  parseWeeklyPlanningConditionOperations,
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

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '大学',
    subject: '大学',
    date: '2026-06-26',
    startTime: '10:00',
    endTime: '11:00',
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'school-event',
    memo: '',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    sourceType: 'manual',
    sourceId: null,
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
  describe('study task profile and session length policy phase 1', () => {
    it('keeps task names as profile signals rather than fixed target minutes', () => {
      const profile = inferStudyTaskProfile('英単語を180分');
      const defaultPolicy = deriveSessionLengthPolicy(profile);
      const userPolicy = deriveSessionLengthPolicy(profile, {
        override: {
          mode: 'user_fixed',
          minSessionMinutes: 60,
          targetSessionMinutes: 120,
          maxSessionMinutes: 120,
          allowSmallRemainder: false,
          userExplicit: true,
        },
      });

      expect(profile).not.toHaveProperty('targetSessionMinutes');
      expect(defaultPolicy.mode).toBe('short_focus');
      expect(userPolicy).toMatchObject({
        mode: 'user_fixed',
        targetSessionMinutes: 120,
        maxSessionMinutes: 120,
        userExplicit: true,
      });
    });

    it('infers vocabulary as short-focus leaning and long reading as balanced leaning', () => {
      const vocabularyProfile = inferStudyTaskProfile('英単語を暗記する');
      const longReadingProfile = inferStudyTaskProfile('英語長文を読む');

      expect(vocabularyProfile.chunkability).toBeGreaterThan(
        longReadingProfile.chunkability,
      );
      expect(vocabularyProfile.repetitionBenefit).toBeGreaterThan(
        longReadingProfile.repetitionBenefit,
      );
      expect(deriveSessionLengthPolicy(vocabularyProfile).mode).toBe('short_focus');
      expect(deriveSessionLengthPolicy(longReadingProfile).mode).toBe('balanced');
    });

    it('infers different profiles for Java grammar review and Java implementation', () => {
      const grammarProfile = inferStudyTaskProfile('Java文法復習');
      const implementationProfile = inferStudyTaskProfile('Java実装');

      expect(grammarProfile.chunkability).toBeGreaterThan(
        implementationProfile.chunkability,
      );
      expect(implementationProfile.contextRetentionCost).toBeGreaterThan(
        grammarProfile.contextRetentionCost,
      );
      expect(implementationProfile.switchingCost).toBeGreaterThan(
        grammarProfile.switchingCost,
      );
      expect(deriveSessionLengthPolicy(grammarProfile).mode).toBe('short_focus');
      expect(deriveSessionLengthPolicy(implementationProfile).mode).toBe('deep_work');
    });

    it('infers different profiles for graduation research reading writing and annotation', () => {
      const readingProfile = inferStudyTaskProfile('卒研 文献読み');
      const writingProfile = inferStudyTaskProfile('卒研 文章作成');
      const annotationProfile = inferStudyTaskProfile('卒研 アノテーション');

      expect(readingProfile.fatigueRisk).toBeGreaterThan(
        annotationProfile.fatigueRisk,
      );
      expect(annotationProfile.chunkability).toBeGreaterThan(
        writingProfile.chunkability,
      );
      expect(annotationProfile.feedbackGranularity).toBeGreaterThan(
        readingProfile.feedbackGranularity,
      );
      expect(writingProfile.contextRetentionCost).toBeGreaterThan(
        annotationProfile.contextRetentionCost,
      );
    });

    it('derives short balanced and deep policies from profile signals', () => {
      const shortPolicy = deriveSessionLengthPolicy({
        cognitiveLoad: 2,
        contextRetentionCost: 2,
        chunkability: 5,
        feedbackGranularity: 5,
        fatigueRisk: 2,
        switchingCost: 2,
        repetitionBenefit: 5,
        deadlinePressure: 3,
      });
      const balancedPolicy = deriveSessionLengthPolicy({
        cognitiveLoad: 5,
        contextRetentionCost: 4,
        chunkability: 2,
        feedbackGranularity: 3,
        fatigueRisk: 4,
        switchingCost: 3,
        repetitionBenefit: 2,
        deadlinePressure: 3,
      });
      const deepPolicy = deriveSessionLengthPolicy({
        cognitiveLoad: 4,
        contextRetentionCost: 5,
        chunkability: 2,
        feedbackGranularity: 3,
        fatigueRisk: 3,
        switchingCost: 5,
        repetitionBenefit: 2,
        deadlinePressure: 3,
      });

      expect(shortPolicy).toMatchObject({
        mode: 'short_focus',
        minSessionMinutes: 30,
        targetSessionMinutes: 60,
        maxSessionMinutes: 90,
        allowSmallRemainder: true,
      });
      expect(balancedPolicy).toMatchObject({
        mode: 'balanced',
        minSessionMinutes: 45,
        targetSessionMinutes: 90,
        maxSessionMinutes: 120,
        allowSmallRemainder: false,
      });
      expect(deepPolicy).toMatchObject({
        mode: 'deep_work',
        minSessionMinutes: 60,
        targetSessionMinutes: 105,
        maxSessionMinutes: 120,
        allowSmallRemainder: false,
      });
    });

    it('keeps 120 minutes out of the default center while allowing explicit 120-minute policy', () => {
      const implementationProfile = inferStudyTaskProfile('Java実装');
      const defaultPolicy = deriveSessionLengthPolicy(implementationProfile);
      const explicitPolicy = deriveSessionLengthPolicy(implementationProfile, {
        override: {
          targetSessionMinutes: 120,
          maxSessionMinutes: 120,
          userExplicit: true,
        },
      });

      expect(defaultPolicy.mode).toBe('deep_work');
      expect(defaultPolicy.targetSessionMinutes).not.toBe(120);
      expect(explicitPolicy).toMatchObject({
        mode: 'user_fixed',
        targetSessionMinutes: 120,
        maxSessionMinutes: 120,
        userExplicit: true,
      });
    });

    it('treats user explicit policy as higher priority than default heuristics', () => {
      const shortProfile = inferStudyTaskProfile('英単語');
      const policy = deriveSessionLengthPolicy(shortProfile, {
        override: {
          minSessionMinutes: 60,
          targetSessionMinutes: 90,
          maxSessionMinutes: 90,
          allowSmallRemainder: false,
          userExplicit: true,
        },
      });

      expect(policy).toMatchObject({
        mode: 'user_fixed',
        minSessionMinutes: 60,
        targetSessionMinutes: 90,
        maxSessionMinutes: 90,
        allowSmallRemainder: false,
        userExplicit: true,
      });
    });
  });

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

  it('asks for task details instead of creating drafts for vague weekly input', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週ちょっと勉強したい',
    });

    expect(assessment.kind).toBe('needs_task_details');
    expect(assessment.tasks).toEqual([]);
    expect(assessment.questions[0]).toContain('タスク名と合計時間');
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
      text: '来週、英語を2時間やりたい',
      existingPlans: [],
    });

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ date: '2026-06-26', title: '英語' });
    expect(minutesFromClock(result.blocks[0].startTime)).toBeGreaterThanOrEqual(
      minutesFromClock('11:00'),
    );
    expect(minutesFromClock(result.blocks[0].endTime)).toBeLessThanOrEqual(
      minutesFromClock('18:00'),
    );
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
    expect(result.blocks).toHaveLength(2);
    expect(
      result.blocks.every(
        (block) => minutesBetween(block.startTime, block.endTime) >= 30,
      ),
    ).toBe(true);
  });

  it('extracts deadlines and high priority metadata for weekly planning tasks', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、6/30までに重要なレポート作成を4時間、英語を2時間やりたい',
    });

    expect(assessment.tasks[0]).toMatchObject({
      title: 'レポート作成',
      priority: 'high',
      deadlineDate: '2026-06-30',
    });
    expect(assessment.tasks[1]).toMatchObject({
      title: '英語',
      priority: 'normal',
    });
    expect(assessment.confirmationSummary).toContain('週の前半');
  });

  it('places high-priority or deadline tasks earlier and keeps planning metadata in memo', () => {
    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間、6/30までに重要なレポート作成を2時間やりたい',
      existingPlans: [],
    });
    const reportBlock = result.blocks.find((block) => block.title === 'レポート作成');
    const englishBlock = result.blocks.find((block) => block.title === '英語');

    expect(reportBlock).toBeDefined();
    expect(englishBlock).toBeDefined();
    expect(reportBlock?.date.localeCompare(englishBlock?.date ?? '')).toBeLessThanOrEqual(
      0,
    );
    expect(reportBlock?.memo).toContain('優先度: 高');
    expect(reportBlock?.memo).toContain('締切: 2026-06-30');
    expect(reportBlock?.memo).toContain('対象週: 2026-06-26〜2026-07-02');
    expect(reportBlock?.memo).toContain('予備日: 2026-07-02');
    expect(reportBlock?.memo).toContain('配置済み: 120分');
  });

  it('uses explicit life-cycle settings but still asks for final confirmation on omakase', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間やりたい。7時起床、23時就寝、前後60分、最大90分、休憩15分でおまかせ',
    });

    expect(assessment.kind).toBe('needs_confirmation');
    expect(assessment.defaults).toMatchObject({
      wakeTime: '07:00',
      sleepStartTime: '23:00',
      bufferMinutes: 60,
      maxSessionMinutes: 90,
      breakMinutes: 15,
      deepNightAllowed: false,
    });
    expect(assessment.confirmationSummary).toContain('睡眠 23:00-翌07:00');
    expect(assessment.confirmationSummary).toContain('既存予定前後60分');
    expect(assessment.confirmationSummary).toContain('最大90分');
    expect(assessment.confirmationSummary).toContain('休憩15分');
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

  it('keeps non-time study amounts and asks for estimate confirmation before drafting', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、ターゲット1900を300語、青チャート数列を30問、英語長文を毎日2題、化学重要問題集を20問。おまかせ',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks.map((task) => task.title)).toEqual([
      'ターゲット1900',
      '青チャート数列',
      '英語長文',
      '化学重要問題集',
    ]);
    expect(assessment.tasks.map((task) => task.amount)).toEqual([
      expect.objectContaining({ unit: 'words', value: 300, daily: false }),
      expect.objectContaining({ unit: 'problems', value: 30, daily: false }),
      expect.objectContaining({ unit: 'passages', value: 2, daily: true }),
      expect.objectContaining({ unit: 'problems', value: 20, daily: false }),
    ]);
    expect(assessment.questions.join('\n')).toContain('何分相当');
    expect(assessment.confirmationSummary).toContain('50語=30分');
    expect(assessment.confirmationSummary).toContain('1問=10分');
    expect(
      createAvailabilityAwareWeeklyDraftBlocksFromText({
        userId: 'user-1',
        selectedDate: '2026-06-19',
        text: assessment.tasks.map((task) => task.sourceText).join('、'),
        existingPlans: [],
      }).blocks,
    ).toEqual([]);
  });

  it('keeps daily units separate instead of collapsing them into one day', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英単語を毎日50語、リスニングを毎日30分、数学を1日10問',
    });

    expect(assessment.kind).toBe('needs_time_estimate');
    expect(assessment.tasks.map((task) => [task.title, task.amount.daily])).toEqual([
      ['英単語', true],
      ['リスニング', true],
      ['数学', true],
    ]);
    expect(assessment.tasks.find((task) => task.title === 'リスニング')).toMatchObject({
      durationMinutes: 30,
      requiresTimeEstimate: false,
    });
  });

  it('does not treat placement conditions as weekly planning tasks', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、英語を2時間、7時起床、23時就寝、最大90分、休憩15分、前後60分、深夜OK、午後中心、11時から、18時まで',
    });

    expect(assessment.tasks.map((task) => task.title)).toEqual(['英語']);
    expect(assessment.tasks[0]).toMatchObject({
      durationMinutes: 120,
      title: '英語',
    });
    expect(assessment.defaults).toMatchObject({
      wakeTime: '07:00',
      sleepStartTime: '23:00',
      maxSessionMinutes: 90,
      breakMinutes: 15,
      bufferMinutes: 60,
      deepNightAllowed: true,
    });
  });

  it('preserves task-name suffixes that describe the actual study work', () => {
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: '来週、レポート作成を4時間、Java実装を3時間、Obsidian整理を2時間、過去問演習を2時間、間違い直しを1時間',
    });

    expect(assessment.tasks.map((task) => task.title)).toEqual([
      'レポート作成',
      'Java実装',
      'Obsidian整理',
      '過去問演習',
      '間違い直し',
    ]);
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

  it('retries a 120 minute session as 90 and 30 minute blocks when needed', () => {
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
      90,
      30,
    ]);
  });

  it('reuses a 30 minute slot after the break window', () => {
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
      text: '来週、英語を3時間。この条件で作成',
      existingPlans,
      allowPartialPlacement: true,
    });

    expect(result.unplacedMinutes).toBe(0);
    expect(result.blocks.map((block) => minutesBetween(block.startTime, block.endTime))).toEqual([
      90,
      60,
      30,
    ]);
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

    for (const reply of ['7日間で', '1回90分で', '13時から22時で']) {
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
          minutesFromClock(block.startTime) >= minutesFromClock('13:00') &&
          minutesFromClock(block.endTime) <= minutesFromClock('22:00'),
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
    expect(result.blocks).toHaveLength(2);
    expect(
      result.blocks.every(
        (block) => minutesBetween(block.startTime, block.endTime) <= 90,
      ),
    ).toBe(true);
    expect(
      result.blocks.every(
        (block) =>
          minutesFromClock(block.startTime) >= minutesFromClock('07:00') &&
          minutesFromClock(block.endTime) <= minutesFromClock('23:00'),
      ),
    ).toBe(true);
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

});
