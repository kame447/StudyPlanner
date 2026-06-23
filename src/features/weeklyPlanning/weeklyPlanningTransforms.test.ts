import { describe, expect, it } from 'vitest';
import type { Plan, PlanDraft } from '../../types/domain';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createDefaultUserPlanningProfile,
  createFallbackWeeklyDraftBlock,
  createSessionChunkCandidates,
  derivePersonalizedSessionPolicy,
  deriveSessionLengthPolicy,
  createPlanDraftFromWeeklyDraftBlock,
  createSimpleWeeklyDraftBlocksFromText,
  createWeeklyDraftBlockFromPlanDraft,
  createWeeklyPlanningPendingConfig,
  distributeWeeklyDraftBlocks,
  inferStudyTaskProfile,
  mergeWeeklyPlanningRevision,
  parseWeeklyPlanningConditionOperations,
  summarizeWeeklyPlanningPendingConfig,
  splitDurationIntoSessionChunks,
  updateUserPlanningProfileFromFeedback,
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

function sortBlocksByStartTime(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): ReturnType<typeof createSimpleWeeklyDraftBlocksFromText> {
  return blocks
    .slice()
    .sort(
      (left, right) =>
        minutesFromClock(left.startTime) - minutesFromClock(right.startTime),
    );
}

function countSubjectSwitches(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): number {
  const sortedBlocks = sortBlocksByStartTime(blocks);

  return sortedBlocks.reduce((switches, block, index) => {
    if (index === 0) {
      return switches;
    }

    return sortedBlocks[index - 1].title === block.title ? switches : switches + 1;
  }, 0);
}

function countSameDaySubjectFragmentations(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): number {
  const runsByTitle = new Map<string, number>();
  let previousTitle: string | undefined;

  sortBlocksByStartTime(blocks).forEach((block) => {
    if (block.title !== previousTitle) {
      runsByTitle.set(block.title, (runsByTitle.get(block.title) ?? 0) + 1);
    }

    previousTitle = block.title;
  });

  return Array.from(runsByTitle.values()).reduce(
    (total, runs) => total + Math.max(0, runs - 1),
    0,
  );
}

function maxRunsForSameTitleInDay(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
): number {
  const runsByTitle = new Map<string, number>();
  let previousTitle: string | undefined;

  sortBlocksByStartTime(blocks).forEach((block) => {
    if (block.title !== previousTitle) {
      runsByTitle.set(block.title, (runsByTitle.get(block.title) ?? 0) + 1);
    }

    previousTitle = block.title;
  });

  return Math.max(0, ...Array.from(runsByTitle.values()));
}

function averageStartMinutesByDateForTitle(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
  title: string,
): number[] {
  return Object.values(blocksGroupedByDate(blocks))
    .map((dateBlocks) => dateBlocks.filter((block) => block.title === title))
    .filter((dateBlocks) => dateBlocks.length > 0)
    .map((dateBlocks) =>
      dateBlocks.reduce((sum, block) => sum + minutesFromClock(block.startTime), 0) /
      dateBlocks.length,
    );
}

function lateMinutesForTitles(
  blocks: ReturnType<typeof createSimpleWeeklyDraftBlocksFromText>,
  titlePattern: RegExp,
): number {
  return blocks
    .filter((block) => titlePattern.test(block.title))
    .reduce((total, block) => {
      const startMinutes = minutesFromClock(block.startTime);
      const endMinutes = minutesFromClock(block.endTime);
      return total + Math.max(0, endMinutes - Math.max(startMinutes, 22 * 60));
    }, 0);
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

  describe('user planning personalization phase 2.5', () => {
    it('creates a neutral initial user planning profile', () => {
      const profile = createDefaultUserPlanningProfile();

      expect(profile).toMatchObject({
        version: 1,
        feedbackCount: 0,
        confidence: 0,
        preferredSessionMinutes: 90,
        minSessionMinutes: 45,
        maxSessionMinutes: 120,
        dislikesTinyBlocks: 0.5,
        prefersLongSessions: 0.5,
        morningReliability: 0.5,
        nightHeavyTaskReliability: 0.5,
        taskPreferences: {},
      });
    });

    it('learns that deleted 30 minute blocks indicate tiny block dislike', () => {
      const profile = updateUserPlanningProfileFromFeedback(
        createDefaultUserPlanningProfile(),
        { kind: 'block_deleted', durationMinutes: 30, taskTitle: '英単語' },
      );

      expect(profile.dislikesTinyBlocks).toBeGreaterThan(0.5);
      expect(profile.dislikesTinyBlocks).toBeLessThan(0.65);
      expect(profile.taskPreferences.memorization.dislikesTinyBlocks).toBeGreaterThan(0.5);
    });

    it('learns toward 90 minutes when a 120 minute session is shortened to 90', () => {
      const startingProfile = {
        ...createDefaultUserPlanningProfile(),
        preferredSessionMinutes: 120,
      };
      const profile = updateUserPlanningProfileFromFeedback(startingProfile, {
        kind: 'session_resized',
        fromMinutes: 120,
        toMinutes: 90,
        taskTitle: '卒研 文章作成',
      });

      expect(profile.preferredSessionMinutes).toBeLessThan(120);
      expect(profile.preferredSessionMinutes).toBeGreaterThan(90);
      expect(profile.prefersLongSessions).toBeLessThan(0.5);
    });

    it('lowers morning reliability when morning sessions are often moved later', () => {
      const profile = updateUserPlanningProfileFromFeedback(
        createDefaultUserPlanningProfile(),
        {
          kind: 'session_moved',
          taskTitle: '英語長文',
          fromStartTime: '08:30',
          toStartTime: '14:00',
        },
      );

      expect(profile.morningReliability).toBeLessThan(0.5);
      expect(profile.morningReliability).toBeGreaterThan(0.35);
    });

    it('strengthens research preference when a 90 minute graduation research session is completed', () => {
      const profile = updateUserPlanningProfileFromFeedback(
        createDefaultUserPlanningProfile(),
        {
          kind: 'session_completed',
          durationMinutes: 90,
          taskTitle: '卒研 文献読み',
          taskProfile: inferStudyTaskProfile('卒研 文献読み'),
        },
      );

      expect(profile.taskPreferences.research).toMatchObject({
        taskKey: 'research',
        sampleCount: 1,
      });
      expect(profile.taskPreferences.research.preferredSessionMinutes).toBe(90);
      expect(profile.taskPreferences.research.completionRate).toBeGreaterThan(0.5);
      expect(profile.taskPreferences.research.prefersLongSessions).toBeGreaterThan(0.5);
    });

    it('keeps low-confidence learning gradual and avoids overfitting one exception', () => {
      const lowConfidenceProfile = {
        ...createDefaultUserPlanningProfile(),
        preferredSessionMinutes: 120,
        confidence: 0,
      };
      const highConfidenceProfile = {
        ...createDefaultUserPlanningProfile(),
        feedbackCount: 30,
        preferredSessionMinutes: 120,
        confidence: 0.8,
      };
      const signal = {
        kind: 'session_resized' as const,
        fromMinutes: 120,
        toMinutes: 60,
        taskTitle: 'Java実装',
      };
      const lowResult = updateUserPlanningProfileFromFeedback(
        lowConfidenceProfile,
        signal,
      );
      const highResult = updateUserPlanningProfileFromFeedback(
        highConfidenceProfile,
        signal,
      );

      expect(120 - lowResult.preferredSessionMinutes).toBeLessThan(
        120 - highResult.preferredSessionMinutes,
      );
      expect(lowResult.preferredSessionMinutes).toBeGreaterThan(110);
      expect(lowResult.confidence).toBeLessThan(0.1);
    });

    it('lets explicit preference override learned preference', () => {
      const taskProfile = inferStudyTaskProfile('英単語');
      const learnedProfile = updateUserPlanningProfileFromFeedback(
        createDefaultUserPlanningProfile(),
        {
          kind: 'explicit_preference',
          preferredSessionMinutes: 60,
          taskTitle: '英単語',
        },
      );
      const policy = derivePersonalizedSessionPolicy({
        taskTitle: '英単語',
        taskProfile,
        userProfile: learnedProfile,
        explicitOverride: {
          minSessionMinutes: 60,
          targetSessionMinutes: 120,
          maxSessionMinutes: 120,
          allowSmallRemainder: false,
          userExplicit: true,
        },
      });

      expect(policy).toMatchObject({
        mode: 'user_fixed',
        minSessionMinutes: 60,
        targetSessionMinutes: 120,
        maxSessionMinutes: 120,
        userExplicit: true,
        personalizationApplied: true,
      });
      expect(policy.reasons).toContain('explicit-override');
    });

    it('derives personalized session policy from global and task preferences', () => {
      let userProfile = createDefaultUserPlanningProfile();
      userProfile = updateUserPlanningProfileFromFeedback(userProfile, [
        {
          kind: 'session_completed',
          durationMinutes: 90,
          taskTitle: '卒研 文献読み',
          taskProfile: inferStudyTaskProfile('卒研 文献読み'),
        },
        {
          kind: 'session_completed',
          durationMinutes: 90,
          taskTitle: '卒研 文章作成',
          taskProfile: inferStudyTaskProfile('卒研 文章作成'),
        },
        {
          kind: 'block_deleted',
          durationMinutes: 25,
          taskTitle: '卒研 文章作成',
          taskProfile: inferStudyTaskProfile('卒研 文章作成'),
        },
      ]);
      const taskProfile = inferStudyTaskProfile('卒研 文章作成');
      const basePolicy = deriveSessionLengthPolicy(taskProfile);
      const policy = derivePersonalizedSessionPolicy({
        taskTitle: '卒研 文章作成',
        taskProfile,
        basePolicy,
        userProfile,
      });

      expect(policy.basePolicy).toEqual(basePolicy);
      expect(policy.personalizationApplied).toBe(true);
      expect(policy.confidence).toBeGreaterThan(0);
      expect(policy.targetSessionMinutes).toBeLessThanOrEqual(
        basePolicy.targetSessionMinutes,
      );
      expect(policy.targetSessionMinutes).toBeGreaterThanOrEqual(90);
      expect(policy.minSessionMinutes).toBeGreaterThanOrEqual(45);
      expect(policy.minSessionMinutes).toBeLessThanOrEqual(
        basePolicy.minSessionMinutes,
      );
      expect(policy.reasons).toContain('learned-user-profile');
    });
  });

  describe('session chunk splitting phase 2', () => {
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
    const shortFocusPolicy = deriveSessionLengthPolicy(inferStudyTaskProfile('英単語'));
    const userFixedTwoHourPolicy = deriveSessionLengthPolicy(
      inferStudyTaskProfile('Java実装'),
      {
        override: {
          minSessionMinutes: 60,
          targetSessionMinutes: 120,
          maxSessionMinutes: 120,
          allowSmallRemainder: false,
          userExplicit: true,
        },
      },
    );
    const heavyProfile = inferStudyTaskProfile('計算理論の証明問題');
    const lightProfile = inferStudyTaskProfile('英単語');

    function expectChunksToBeValid(chunks: number[], totalMinutes: number, maxMinutes: number) {
      expect(chunks.reduce((sum, chunk) => sum + chunk, 0)).toBe(totalMinutes);
      expect(chunks.every((chunk) => chunk <= maxMinutes)).toBe(true);
    }

    it('splits balanced 180 minutes into two 90 minute chunks', () => {
      expect(
        splitDurationIntoSessionChunks(180, balancedPolicy, heavyProfile),
      ).toEqual([90, 90]);
    });

    it('splits balanced 240 minutes without sticking to 120 minute chunks', () => {
      expect(
        splitDurationIntoSessionChunks(240, balancedPolicy, heavyProfile),
      ).toEqual([90, 90, 60]);
    });

    it('splits balanced 300 minutes into target-sized and useful remainder chunks', () => {
      expect(
        splitDurationIntoSessionChunks(300, balancedPolicy, heavyProfile),
      ).toEqual([90, 90, 60, 60]);
    });

    it('splits short-focus 180 and 240 minutes around 60 minutes', () => {
      expect(
        splitDurationIntoSessionChunks(180, shortFocusPolicy, lightProfile),
      ).toEqual([60, 60, 60]);
      expect(
        splitDurationIntoSessionChunks(240, shortFocusPolicy, lightProfile),
      ).toEqual([60, 60, 60, 60]);
    });

    it('allows explicit two-hour session chunks when the user fixed that preference', () => {
      expect(
        splitDurationIntoSessionChunks(
          180,
          userFixedTwoHourPolicy,
          inferStudyTaskProfile('Java実装'),
        ),
      ).toEqual([120, 60]);
      expect(
        splitDurationIntoSessionChunks(
          240,
          userFixedTwoHourPolicy,
          inferStudyTaskProfile('Java実装'),
        ),
      ).toEqual([120, 120]);
    });

    it('does not create multiple blocks under minSessionMinutes', () => {
      const chunks = splitDurationIntoSessionChunks(
        130,
        shortFocusPolicy,
        lightProfile,
      );

      expect(
        chunks.filter((chunk) => chunk < shortFocusPolicy.minSessionMinutes).length,
      ).toBeLessThanOrEqual(1);
      expectChunksToBeValid(chunks, 130, shortFocusPolicy.maxSessionMinutes);
    });

    it('avoids sub-30-minute remainder chunks when small remainders are disabled', () => {
      const chunks = splitDurationIntoSessionChunks(
        125,
        balancedPolicy,
        heavyProfile,
      );

      expect(chunks.every((chunk) => chunk >= 30)).toBe(true);
      expectChunksToBeValid(chunks, 125, balancedPolicy.maxSessionMinutes);
    });

    it('allows only the final small remainder when small remainders are enabled', () => {
      const constrainedPolicy = {
        ...shortFocusPolicy,
        targetSessionMinutes: 60,
        maxSessionMinutes: 60,
        allowSmallRemainder: true,
      };
      const candidate = createSessionChunkCandidates(130, constrainedPolicy).find(
        (chunks) => chunks.some((chunk) => chunk < constrainedPolicy.minSessionMinutes),
      );

      expect(candidate).toBeDefined();
      if (!candidate) return;
      const smallChunks = candidate.filter(
        (chunk) => chunk < constrainedPolicy.minSessionMinutes,
      );

      expect(smallChunks).toHaveLength(1);
      expect(candidate[candidate.length - 1]).toBe(smallChunks[0]);
      expectChunksToBeValid(candidate, 130, constrainedPolicy.maxSessionMinutes);
    });

    it('keeps total minutes exact and every chunk within maxSessionMinutes', () => {
      [95, 180, 240, 300, 360].forEach((totalMinutes) => {
        const chunks = splitDurationIntoSessionChunks(
          totalMinutes,
          balancedPolicy,
          heavyProfile,
        );

        expectChunksToBeValid(chunks, totalMinutes, balancedPolicy.maxSessionMinutes);
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

  it('keeps quality preferences from overriding numeric planning conditions', () => {
    const sourceText = '来週、英語を3時間、計算理論を4時間、卒研を2時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: `6日間に分散
1日1科目だけになりにくい
1回が30分台にならない
重いタスクが細切れにならない`,
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults.dayCount).toBe(6);
    expect(override.config.defaults.maxSessionMinutes).not.toBe(30);
    expect(override.config.qualityPreferences).toEqual(
      expect.arrayContaining([
        'preferTaskSpread',
        'avoidSingleSubjectDay',
        'avoidTinyChunks',
        'avoidFragmentingHeavyTasks',
      ]),
    );

    const summary = summarizeWeeklyPlanningPendingConfig(override.config);
    expect(summary).not.toContain('1日間');
    expect(summary).not.toContain('最大30分');
  });

  it('keeps explicit numeric condition replies working alongside quality preferences', () => {
    expect(parseWeeklyPlanningConditionOperations('3日間でやって')).toContainEqual({
      kind: 'setDayCount',
      dayCount: 3,
    });
    expect(parseWeeklyPlanningConditionOperations('1回90分で')).toContainEqual({
      kind: 'setMaxSessionMinutes',
      minutes: 90,
    });
    expect(parseWeeklyPlanningConditionOperations('長めで')).toContainEqual({
      kind: 'addSessionIntentOverride',
      override: { scope: 'global', kind: 'prefer_long', targetSessionMinutes: 120 },
    });
    expect(parseWeeklyPlanningConditionOperations('2時間単位で')).toContainEqual({
      kind: 'addSessionIntentOverride',
      override: { scope: 'global', kind: 'fixed_two_hour', targetSessionMinutes: 120 },
    });
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

  it('keeps follow-up quality preference text out of task titles and draft labels', () => {
    const sourceText = '来週、英語10時間、数学8時間、卒研6時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '6日間に分散\n1日1科目だけになりにくい\n1回が30分台にならない\n重いタスクが細切れにならない',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.tasks.map((task) => task.title)).toEqual([
      '英語',
      '数学',
      '卒研',
    ]);
    override.config.tasks.forEach((task) => {
      expect(task.title).not.toMatch(/6日間|分散|やりたい|30分台|細切れ|1日1科目/);
    });

    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: 'この条件で作成',
      pendingConfig: override.config,
    });
    const allowedTitles = new Set(['英語', '数学', '卒研']);

    result.blocks.forEach((block) => {
      expect(allowedTitles.has(block.title)).toBe(true);
      [block.title, block.subject, block.label].forEach((value) => {
        expect(value).not.toMatch(/6日間|分散|やりたい|30分台|細切れ|1日1科目/);
      });
    });
  });

  it('exposes quality preferences to availability-aware placement diagnostics', () => {
    const sourceText = '来週、英語3時間、数学3時間、卒研3時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '6日間に分散\n1日1科目だけになりにくい\n30分台を避けたい',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.qualityPreferences).toEqual(
      expect.arrayContaining([
        'preferTaskSpread',
        'avoidSingleSubjectDay',
        'avoidTinyChunks',
      ]),
    );

    const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
      userId: 'user-1',
      selectedDate: '2026-06-19',
      text: 'この条件で作成',
      pendingConfig: override.config,
    });

    expect(result.diagnostics?.qualityPreferences).toEqual(
      expect.arrayContaining([
        'preferTaskSpread',
        'avoidSingleSubjectDay',
        'avoidTinyChunks',
      ]),
    );
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
