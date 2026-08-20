import type {
  PlanningTaskFact,
  StudyContextFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';

export const WEEKLY_PLANNING_STABLE_V5_DEFAULT_MIN_SESSION_MINUTES = 30;
export const WEEKLY_PLANNING_STABLE_V5_DEFAULT_MAX_SESSION_MINUTES = 120;
export const WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES = 5;

export interface WeeklyPlanningExecutionProfileV5 {
  cognitiveLoad: number;
  contextRetentionCost: number;
  chunkability: number;
  feedbackGranularity: number;
  fatigueRisk: number;
  switchingCost: number;
  repetitionBenefit: number;
}

export type WeeklyPlanningSessionPolicyModeV5 =
  | 'short_focus'
  | 'balanced'
  | 'deep_work';

export interface WeeklyPlanningSessionPolicyV5 {
  mode: WeeklyPlanningSessionPolicyModeV5;
  minSessionMinutes: number;
  targetSessionMinutes: number;
  maxSessionMinutes: number;
  allowSmallRemainder: boolean;
  personalizedTargetApplied: boolean;
}

export interface WeeklyPlanningExecutionPolicyGraphViewV5 {
  readonly tasks: ReadonlyArray<PlanningTaskFact>;
  readonly studyContexts?: ReadonlyArray<StudyContextFact>;
  readonly workloads: ReadonlyArray<Pick<WorkloadFact, 'id' | 'unitCode'>>;
}

export const DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5: WeeklyPlanningExecutionProfileV5 = {
  cognitiveLoad: 3,
  contextRetentionCost: 3,
  chunkability: 3,
  feedbackGranularity: 3,
  fatigueRisk: 3,
  switchingCost: 3,
  repetitionBenefit: 3,
};

function clampScore(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function patchProfile(
  profile: WeeklyPlanningExecutionProfileV5,
  patch: Partial<WeeklyPlanningExecutionProfileV5>,
): WeeklyPlanningExecutionProfileV5 {
  const next = { ...profile };
  (Object.keys(patch) as Array<keyof WeeklyPlanningExecutionProfileV5>).forEach((key) => {
    const value = patch[key];
    if (value !== undefined) next[key] = clampScore(value);
  });
  return next;
}

export function inferWeeklyPlanningExecutionProfileV5(params: {
  graph: WeeklyPlanningExecutionPolicyGraphViewV5;
  item: GenericPlanningWorkItem;
}): WeeklyPlanningExecutionProfileV5 {
  const workload = params.graph.workloads.find((fact) => fact.id === params.item.workloadFactId);
  const studyContext = params.graph.studyContexts?.find((fact) => fact.taskId === params.item.taskId);
  let profile = { ...DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5 };

  // Execution traits come from explicit structured context, not generic unit codes or labels.
  if (studyContext?.purpose === 'review' || studyContext?.purpose === 'habit') {
    profile = patchProfile(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 4,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 5,
    });
  }

  if (studyContext?.purpose === 'research') {
    profile = patchProfile(profile, {
      cognitiveLoad: 4,
      contextRetentionCost: 4,
      fatigueRisk: 3,
      switchingCost: 4,
    });
  }

  if (workload?.unitCode === 'mock_exam') {
    profile = patchProfile(profile, {
      cognitiveLoad: 5,
      contextRetentionCost: 5,
      chunkability: 1,
      feedbackGranularity: 2,
      fatigueRisk: 4,
      switchingCost: 5,
      repetitionBenefit: 1,
    });
  }

  return profile;
}

function roundToQuantum(value: number): number {
  return Math.round(value / WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES)
    * WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES;
}

function clampMinutes(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function deriveWeeklyPlanningSessionPolicyV5(params: {
  profile: WeeklyPlanningExecutionProfileV5;
  preferredSessionMinutes?: number | null;
  absoluteMaxSessionMinutes?: number;
  minimumSessionMinutes?: number;
}): WeeklyPlanningSessionPolicyV5 {
  const absoluteMax = Math.max(
    30,
    params.absoluteMaxSessionMinutes ?? WEEKLY_PLANNING_STABLE_V5_DEFAULT_MAX_SESSION_MINUTES,
  );
  const minimum = Math.max(
    1,
    params.minimumSessionMinutes ?? WEEKLY_PLANNING_STABLE_V5_DEFAULT_MIN_SESSION_MINUTES,
  );
  const shortFocusScore = params.profile.chunkability
    + params.profile.feedbackGranularity
    + params.profile.repetitionBenefit
    - params.profile.contextRetentionCost
    - params.profile.switchingCost
    + (6 - params.profile.fatigueRisk) * 0.5;
  const deepWorkScore = params.profile.cognitiveLoad
    + params.profile.contextRetentionCost
    + params.profile.switchingCost
    - params.profile.chunkability
    - Math.max(0, params.profile.fatigueRisk - 3) * 2;

  let mode: WeeklyPlanningSessionPolicyModeV5 = 'balanced';
  let minSessionMinutes = Math.max(45, minimum);
  let targetSessionMinutes = 90;
  let maxSessionMinutes = absoluteMax;
  let allowSmallRemainder = false;

  if (shortFocusScore >= 5 && params.profile.contextRetentionCost <= 3) {
    mode = 'short_focus';
    minSessionMinutes = Math.max(30, minimum);
    targetSessionMinutes = 60;
    maxSessionMinutes = Math.min(90, absoluteMax);
    allowSmallRemainder = true;
  } else if (deepWorkScore >= 8 && params.profile.fatigueRisk <= 3) {
    mode = 'deep_work';
    minSessionMinutes = Math.max(60, minimum);
    targetSessionMinutes = 105;
    maxSessionMinutes = absoluteMax;
  }

  minSessionMinutes = Math.min(minSessionMinutes, maxSessionMinutes);
  targetSessionMinutes = clampMinutes(
    targetSessionMinutes,
    minSessionMinutes,
    maxSessionMinutes,
  );

  const preferred = params.preferredSessionMinutes;
  const personalizedTargetApplied = typeof preferred === 'number'
    && Number.isFinite(preferred)
    && preferred > 0;
  if (personalizedTargetApplied) {
    targetSessionMinutes = clampMinutes(
      roundToQuantum(preferred as number),
      minSessionMinutes,
      maxSessionMinutes,
    );
  }

  return {
    mode,
    minSessionMinutes,
    targetSessionMinutes,
    maxSessionMinutes,
    allowSmallRemainder,
    personalizedTargetApplied,
  };
}

export function isHeavyWeeklyPlanningWorkItemV5(params: {
  graph: WeeklyPlanningExecutionPolicyGraphViewV5;
  item: GenericPlanningWorkItem;
}): boolean {
  const profile = inferWeeklyPlanningExecutionProfileV5(params);
  return profile.cognitiveLoad + profile.contextRetentionCost >= 8;
}
