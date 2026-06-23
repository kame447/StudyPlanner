import { minutesFromTime } from '../../../lib/date';
import type {
  PersonalizedSessionPolicy,
  PersonalizedSessionPolicyInput,
  SessionLengthPolicy,
  SessionLengthPolicyMode,
  SessionLengthPolicyOptions,
  SessionLengthPolicyOverride,
  StudyTaskProfile,
  UserPlanningProfile,
  UserTaskPreferenceProfile,
  WeeklyPlanningFeedbackSignal,
} from '../weeklyPlanningTypes';
import { normalizeTaskProfileText } from './studyTaskProfile';

const DEFAULT_MIN_STUDY_BLOCK_MINUTES = 30;
const DEFAULT_MAX_SESSION_MINUTES = 120;

function normalizeSessionLengthPolicy(
  policy: SessionLengthPolicy,
  absoluteMaxSessionMinutes: number,
): SessionLengthPolicy {
  const maxSessionMinutes = Math.max(
    30,
    Math.min(policy.maxSessionMinutes, absoluteMaxSessionMinutes),
  );
  const minSessionMinutes = Math.min(
    maxSessionMinutes,
    Math.max(1, policy.minSessionMinutes),
  );
  const targetSessionMinutes = Math.min(
    maxSessionMinutes,
    Math.max(minSessionMinutes, policy.targetSessionMinutes),
  );

  return {
    ...policy,
    minSessionMinutes,
    targetSessionMinutes,
    maxSessionMinutes,
  };
}

export function mergeSessionLengthPolicyOverride(
  basePolicy: SessionLengthPolicy,
  override: SessionLengthPolicyOverride | undefined,
  absoluteMaxSessionMinutes = DEFAULT_MAX_SESSION_MINUTES,
): SessionLengthPolicy {
  if (!override) {
    return normalizeSessionLengthPolicy(basePolicy, absoluteMaxSessionMinutes);
  }

  return normalizeSessionLengthPolicy(
    {
      ...basePolicy,
      ...override,
      mode: override.userExplicit
        ? override.mode ?? 'user_fixed'
        : override.mode ?? basePolicy.mode,
      userExplicit: override.userExplicit ?? basePolicy.userExplicit,
    },
    absoluteMaxSessionMinutes,
  );
}

export function deriveSessionLengthPolicy(
  profile: StudyTaskProfile,
  options: SessionLengthPolicyOptions = {},
): SessionLengthPolicy {
  const absoluteMaxSessionMinutes = Math.max(
    30,
    options.maxSessionMinutes ?? DEFAULT_MAX_SESSION_MINUTES,
  );
  const minimumSessionMinutes = Math.max(
    1,
    options.minSessionMinutes ?? DEFAULT_MIN_STUDY_BLOCK_MINUTES,
  );
  const shortFocusScore =
    profile.chunkability +
    profile.feedbackGranularity +
    profile.repetitionBenefit -
    profile.contextRetentionCost -
    profile.switchingCost +
    (6 - profile.fatigueRisk) * 0.5;
  const deepWorkScore =
    profile.cognitiveLoad +
    profile.contextRetentionCost +
    profile.switchingCost -
    profile.chunkability -
    Math.max(0, profile.fatigueRisk - 3) * 2;
  const mode: SessionLengthPolicyMode =
    shortFocusScore >= 5 && profile.contextRetentionCost <= 3
      ? 'short_focus'
      : deepWorkScore >= 8 && profile.fatigueRisk <= 3
        ? 'deep_work'
        : 'balanced';
  const basePolicyByMode: Record<
    Exclude<SessionLengthPolicyMode, 'user_fixed'>,
    SessionLengthPolicy
  > = {
    short_focus: {
      mode: 'short_focus',
      minSessionMinutes: Math.max(30, minimumSessionMinutes),
      targetSessionMinutes: 60,
      maxSessionMinutes: Math.min(90, absoluteMaxSessionMinutes),
      allowSmallRemainder: true,
    },
    balanced: {
      mode: 'balanced',
      minSessionMinutes: Math.max(45, minimumSessionMinutes),
      targetSessionMinutes: 90,
      maxSessionMinutes: absoluteMaxSessionMinutes,
      allowSmallRemainder: false,
    },
    deep_work: {
      mode: 'deep_work',
      minSessionMinutes: Math.max(60, minimumSessionMinutes),
      targetSessionMinutes: 105,
      maxSessionMinutes: absoluteMaxSessionMinutes,
      allowSmallRemainder: false,
    },
  };

  return mergeSessionLengthPolicyOverride(
    basePolicyByMode[mode],
    options.override,
    absoluteMaxSessionMinutes,
  );
}

function clampPreference01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function blendPreference(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}

function resolveFeedbackLearningRate(profile: UserPlanningProfile): number {
  return Math.min(0.2, 0.06 + profile.confidence * 0.14);
}

function resolveTaskPreferenceLearningRate(taskPreference: UserTaskPreferenceProfile): number {
  return Math.min(0.24, 0.08 + taskPreference.confidence * 0.16);
}

function createDefaultUserTaskPreferenceProfile(
  taskKey: string,
): UserTaskPreferenceProfile {
  return {
    taskKey,
    sampleCount: 0,
    confidence: 0,
    preferredSessionMinutes: 90,
    minSessionMinutes: 45,
    maxSessionMinutes: DEFAULT_MAX_SESSION_MINUTES,
    dislikesTinyBlocks: 0.5,
    prefersLongSessions: 0.5,
    completionRate: 0.5,
    morningReliability: 0.5,
    nightHeavyTaskReliability: 0.5,
  };
}

export function createDefaultUserPlanningProfile(): UserPlanningProfile {
  return {
    version: 1,
    feedbackCount: 0,
    confidence: 0,
    preferredSessionMinutes: 90,
    minSessionMinutes: 45,
    maxSessionMinutes: DEFAULT_MAX_SESSION_MINUTES,
    dislikesTinyBlocks: 0.5,
    prefersLongSessions: 0.5,
    morningReliability: 0.5,
    nightHeavyTaskReliability: 0.5,
    taskPreferences: {},
  };
}

function resolveUserTaskPreferenceKey(params: {
  taskTitle?: string;
  taskProfile?: StudyTaskProfile;
}): string | null {
  const text = params.taskTitle ? normalizeTaskProfileText(params.taskTitle) : '';

  if (/卒研|研究/.test(text)) {
    return 'research';
  }

  if (/英単語|単語|暗記|用語|定義/.test(text)) {
    return 'memorization';
  }

  if (/java|javascript|typescript|実装|開発/.test(text)) {
    return 'implementation';
  }

  if (/英語|長文|読解/.test(text)) {
    return 'english';
  }

  if (text) {
    return text.slice(0, 32);
  }

  if (params.taskProfile?.contextRetentionCost && params.taskProfile.contextRetentionCost >= 4) {
    return 'context-heavy';
  }

  return null;
}

function isMorningTime(time?: string): boolean {
  return time !== undefined && minutesFromTime(time) < 12 * 60;
}

function isNightTime(time?: string): boolean {
  return time !== undefined && minutesFromTime(time) >= 20 * 60;
}

function updateTaskPreference(
  profile: UserPlanningProfile,
  signal: WeeklyPlanningFeedbackSignal,
  update: (taskPreference: UserTaskPreferenceProfile, rate: number) => UserTaskPreferenceProfile,
): UserPlanningProfile {
  const taskKey = resolveUserTaskPreferenceKey({
    taskTitle: signal.taskTitle,
    taskProfile: signal.taskProfile,
  });

  if (!taskKey) {
    return profile;
  }

  const currentPreference =
    profile.taskPreferences[taskKey] ?? createDefaultUserTaskPreferenceProfile(taskKey);
  const rate = resolveTaskPreferenceLearningRate(currentPreference);
  const nextPreference = update(currentPreference, rate);
  const sampleCount = currentPreference.sampleCount + 1;
  const confidence = clampPreference01(currentPreference.confidence + 0.06);

  return {
    ...profile,
    taskPreferences: {
      ...profile.taskPreferences,
      [taskKey]: {
        ...nextPreference,
        sampleCount,
        confidence,
      },
    },
  };
}

function updateUserPlanningProfileFromSingleFeedback(
  profile: UserPlanningProfile,
  signal: WeeklyPlanningFeedbackSignal,
): UserPlanningProfile {
  const rate = resolveFeedbackLearningRate(profile);
  let nextProfile: UserPlanningProfile = {
    ...profile,
    feedbackCount: profile.feedbackCount + 1,
    confidence: clampPreference01(profile.confidence + 0.04),
    taskPreferences: { ...profile.taskPreferences },
  };

  if (signal.kind === 'block_deleted' && signal.durationMinutes < 40) {
    nextProfile = {
      ...nextProfile,
      dislikesTinyBlocks: clampPreference01(
        blendPreference(nextProfile.dislikesTinyBlocks, 1, rate),
      ),
      minSessionMinutes: Math.round(
        blendPreference(nextProfile.minSessionMinutes, 50, rate),
      ),
    };
  }

  if (signal.kind === 'session_resized') {
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes: Math.round(
        blendPreference(nextProfile.preferredSessionMinutes, signal.toMinutes, rate),
      ),
      prefersLongSessions: clampPreference01(
        blendPreference(
          nextProfile.prefersLongSessions,
          signal.toMinutes < signal.fromMinutes ? 0.25 : 0.75,
          rate,
        ),
      ),
    };
  }

  if (signal.kind === 'session_moved') {
    if (isMorningTime(signal.fromStartTime) && !isMorningTime(signal.toStartTime)) {
      nextProfile = {
        ...nextProfile,
        morningReliability: clampPreference01(
          blendPreference(nextProfile.morningReliability, 0, rate),
        ),
      };
    }
  }

  if (signal.kind === 'session_completed') {
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes: Math.round(
        blendPreference(nextProfile.preferredSessionMinutes, signal.durationMinutes, rate),
      ),
      prefersLongSessions: clampPreference01(
        blendPreference(
          nextProfile.prefersLongSessions,
          signal.durationMinutes >= 90 ? 0.7 : 0.45,
          rate,
        ),
      ),
    };
  }

  if (signal.kind === 'session_uncompleted') {
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes: Math.round(
        blendPreference(
          nextProfile.preferredSessionMinutes,
          Math.min(signal.durationMinutes, 75),
          rate,
        ),
      ),
      prefersLongSessions: clampPreference01(
        blendPreference(nextProfile.prefersLongSessions, 0.25, rate),
      ),
    };

    if (isNightTime(signal.startTime) && (signal.taskProfile?.cognitiveLoad ?? 3) >= 4) {
      nextProfile = {
        ...nextProfile,
        nightHeavyTaskReliability: clampPreference01(
          blendPreference(nextProfile.nightHeavyTaskReliability, 0, rate),
        ),
      };
    }
  }

  if (signal.kind === 'explicit_preference') {
    const explicitRate = Math.max(0.35, rate);
    nextProfile = {
      ...nextProfile,
      preferredSessionMinutes:
        signal.preferredSessionMinutes !== undefined
          ? Math.round(
              blendPreference(
                nextProfile.preferredSessionMinutes,
                signal.preferredSessionMinutes,
                explicitRate,
              ),
            )
          : nextProfile.preferredSessionMinutes,
      minSessionMinutes:
        signal.minSessionMinutes !== undefined
          ? Math.round(
              blendPreference(
                nextProfile.minSessionMinutes,
                signal.minSessionMinutes,
                explicitRate,
              ),
            )
          : nextProfile.minSessionMinutes,
      maxSessionMinutes:
        signal.maxSessionMinutes !== undefined
          ? Math.round(
              blendPreference(
                nextProfile.maxSessionMinutes,
                signal.maxSessionMinutes,
                explicitRate,
              ),
            )
          : nextProfile.maxSessionMinutes,
      dislikesTinyBlocks:
        signal.dislikesTinyBlocks !== undefined
          ? clampPreference01(
              blendPreference(
                nextProfile.dislikesTinyBlocks,
                signal.dislikesTinyBlocks,
                explicitRate,
              ),
            )
          : nextProfile.dislikesTinyBlocks,
      prefersLongSessions:
        signal.prefersLongSessions !== undefined
          ? clampPreference01(
              blendPreference(
                nextProfile.prefersLongSessions,
                signal.prefersLongSessions,
                explicitRate,
              ),
            )
          : nextProfile.prefersLongSessions,
    };
  }

  nextProfile = updateTaskPreference(nextProfile, signal, (taskPreference, taskRate) => {
    if (signal.kind === 'session_completed') {
      return {
        ...taskPreference,
        preferredSessionMinutes: Math.round(
          blendPreference(
            taskPreference.preferredSessionMinutes,
            signal.durationMinutes,
            taskRate,
          ),
        ),
        completionRate: clampPreference01(
          blendPreference(taskPreference.completionRate, 1, taskRate),
        ),
        prefersLongSessions: clampPreference01(
          blendPreference(
            taskPreference.prefersLongSessions,
            signal.durationMinutes >= 90 ? 0.8 : 0.45,
            taskRate,
          ),
        ),
      };
    }

    if (signal.kind === 'session_uncompleted') {
      return {
        ...taskPreference,
        completionRate: clampPreference01(
          blendPreference(taskPreference.completionRate, 0, taskRate),
        ),
        prefersLongSessions: clampPreference01(
          blendPreference(taskPreference.prefersLongSessions, 0.25, taskRate),
        ),
      };
    }

    if (signal.kind === 'session_resized') {
      return {
        ...taskPreference,
        preferredSessionMinutes: Math.round(
          blendPreference(taskPreference.preferredSessionMinutes, signal.toMinutes, taskRate),
        ),
      };
    }

    if (signal.kind === 'block_deleted' && signal.durationMinutes < 40) {
      return {
        ...taskPreference,
        dislikesTinyBlocks: clampPreference01(
          blendPreference(taskPreference.dislikesTinyBlocks, 1, taskRate),
        ),
      };
    }

    if (signal.kind === 'session_moved') {
      return {
        ...taskPreference,
        morningReliability:
          isMorningTime(signal.fromStartTime) && !isMorningTime(signal.toStartTime)
            ? clampPreference01(
                blendPreference(taskPreference.morningReliability, 0, taskRate),
              )
            : taskPreference.morningReliability,
      };
    }

    if (signal.kind === 'explicit_preference') {
      return {
        ...taskPreference,
        preferredSessionMinutes:
          signal.preferredSessionMinutes !== undefined
            ? Math.round(
                blendPreference(
                  taskPreference.preferredSessionMinutes,
                  signal.preferredSessionMinutes,
                  Math.max(0.35, taskRate),
                ),
              )
            : taskPreference.preferredSessionMinutes,
        minSessionMinutes:
          signal.minSessionMinutes !== undefined
            ? Math.round(
                blendPreference(
                  taskPreference.minSessionMinutes,
                  signal.minSessionMinutes,
                  Math.max(0.35, taskRate),
                ),
              )
            : taskPreference.minSessionMinutes,
        maxSessionMinutes:
          signal.maxSessionMinutes !== undefined
            ? Math.round(
                blendPreference(
                  taskPreference.maxSessionMinutes,
                  signal.maxSessionMinutes,
                  Math.max(0.35, taskRate),
                ),
              )
            : taskPreference.maxSessionMinutes,
      };
    }

    return taskPreference;
  });

  return nextProfile;
}

export function updateUserPlanningProfileFromFeedback(
  profile: UserPlanningProfile,
  feedback: WeeklyPlanningFeedbackSignal | WeeklyPlanningFeedbackSignal[],
): UserPlanningProfile {
  const signals = Array.isArray(feedback) ? feedback : [feedback];

  return signals.reduce(updateUserPlanningProfileFromSingleFeedback, profile);
}

export function mergeUserPolicyWithExplicitOverride(
  policy: SessionLengthPolicy,
  explicitOverride?: SessionLengthPolicyOverride,
): SessionLengthPolicy {
  if (!explicitOverride?.userExplicit) {
    return policy;
  }

  return mergeSessionLengthPolicyOverride(policy, explicitOverride);
}

export function derivePersonalizedSessionPolicy(
  input: PersonalizedSessionPolicyInput,
): PersonalizedSessionPolicy {
  const basePolicy = input.basePolicy ?? deriveSessionLengthPolicy(input.taskProfile);
  const explicitPolicy = mergeUserPolicyWithExplicitOverride(
    basePolicy,
    input.explicitOverride,
  );

  if (input.explicitOverride?.userExplicit) {
    return {
      ...explicitPolicy,
      basePolicy,
      confidence: 1,
      personalizationApplied: true,
      reasons: ['explicit-override'],
    };
  }

  const userProfile = input.userProfile;

  if (!userProfile || userProfile.feedbackCount === 0) {
    return {
      ...basePolicy,
      basePolicy,
      confidence: 0,
      personalizationApplied: false,
      reasons: ['base-policy'],
    };
  }

  const taskKey = resolveUserTaskPreferenceKey({
    taskTitle: input.taskTitle,
    taskProfile: input.taskProfile,
  });
  const taskPreference = taskKey ? userProfile.taskPreferences[taskKey] : undefined;
  const taskConfidence = taskPreference?.confidence ?? 0;
  const confidence = Math.max(userProfile.confidence, taskConfidence);
  const strength = Math.min(0.65, confidence * 0.55);
  const targetPreference = taskPreference?.preferredSessionMinutes ?? userProfile.preferredSessionMinutes;
  const minPreference = taskPreference?.minSessionMinutes ?? userProfile.minSessionMinutes;
  const maxPreference = taskPreference?.maxSessionMinutes ?? userProfile.maxSessionMinutes;
  const dislikesTinyBlocks = Math.max(
    userProfile.dislikesTinyBlocks,
    taskPreference?.dislikesTinyBlocks ?? 0,
  );
  const prefersLongSessions = Math.max(
    userProfile.prefersLongSessions,
    taskPreference?.prefersLongSessions ?? 0,
  );
  const nextTarget = Math.round(
    blendPreference(basePolicy.targetSessionMinutes, targetPreference, strength),
  );
  const nextMin = Math.round(
    blendPreference(
      basePolicy.minSessionMinutes,
      dislikesTinyBlocks > 0.6 ? Math.max(minPreference, 45) : minPreference,
      strength,
    ),
  );
  const nextMax = Math.round(
    blendPreference(
      basePolicy.maxSessionMinutes,
      prefersLongSessions > 0.65 ? Math.max(maxPreference, basePolicy.maxSessionMinutes) : maxPreference,
      strength * 0.6,
    ),
  );
  const personalizedPolicy = normalizeSessionLengthPolicy(
    {
      ...basePolicy,
      minSessionMinutes: nextMin,
      targetSessionMinutes: nextTarget,
      maxSessionMinutes: nextMax,
      allowSmallRemainder:
        dislikesTinyBlocks > 0.65 ? false : basePolicy.allowSmallRemainder,
    },
    Math.max(basePolicy.maxSessionMinutes, nextMax),
  );

  return {
    ...personalizedPolicy,
    basePolicy,
    confidence,
    personalizationApplied: strength > 0,
    taskPreference,
    reasons: [
      'learned-user-profile',
      taskPreference ? 'task-preference' : 'global-preference',
      dislikesTinyBlocks > 0.65 ? 'tiny-blocks-disliked' : '',
    ].filter(Boolean),
  };
}

