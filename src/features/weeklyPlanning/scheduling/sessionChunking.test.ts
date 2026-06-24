import { describe, expect, it } from 'vitest';
import {
  createDefaultUserPlanningProfile,
  createSessionChunkCandidates,
  derivePersonalizedSessionPolicy,
  deriveSessionLengthPolicy,
  inferStudyTaskProfile,
  splitDurationIntoSessionChunks,
  updateUserPlanningProfileFromFeedback,
} from '../weeklyPlanningTransforms';
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

describe('scheduling sessionChunking', () => {
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
