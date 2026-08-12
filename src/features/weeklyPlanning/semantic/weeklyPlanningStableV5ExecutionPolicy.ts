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
  readonly studyContexts: ReadonlyArray<StudyContextFact>;
  readonly workloads: ReadonlyArray<WorkloadFact>;
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
  const studyContext = params.graph.studyContexts.find((fact) => fact.taskId === params.item.taskId);
  let profile = { ...DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5 };

  // These mappings deliberately use canonical structured facts only. The legacy
  // pipeline inferred them from Japanese subject/title keywords, which made the
  // scheduler language- and naming-dependent.
  if (workload?.unitCode === 'word') {
    profile = patchProfile(profile, {
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 5,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 5,
    });
  }

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

function normalizeChunks(chunks: number[]): number[] {
  return chunks
    .map((value) => Math.max(0, Math.round(value)))
    .filter((value) => value > 0)
    .sort((left, right) => right - left);
}

function sum(chunks: readonly number[]): number {
  return chunks.reduce((total, value) => total + value, 0);
}

function isValidChunkPlan(
  chunks: readonly number[],
  totalMinutes: number,
  policy: WeeklyPlanningSessionPolicyV5,
): boolean {
  if (chunks.length === 0 || sum(chunks) !== totalMinutes) return false;
  if (chunks.some((chunk) => chunk <= 0 || chunk > policy.maxSessionMinutes)) return false;
  const small = chunks.filter((chunk) => chunk < policy.minSessionMinutes);
  if (small.length === 0) return true;
  return policy.allowSmallRemainder
    && small.length === 1
    && chunks[chunks.length - 1] === small[0];
}

function candidateForChunkCount(
  totalMinutes: number,
  chunkCount: number,
  policy: WeeklyPlanningSessionPolicyV5,
): number[] | null {
  if (chunkCount <= 0) return null;
  const chunks = Array.from({ length: chunkCount }, () => policy.targetSessionMinutes);
  let delta = totalMinutes - sum(chunks);

  if (delta > 0) {
    let cursor = 0;
    let guard = 0;
    while (delta > 0 && guard < 10000) {
      const capacity = policy.maxSessionMinutes - chunks[cursor];
      if (capacity > 0) {
        const step = Math.min(delta, capacity);
        chunks[cursor] += step;
        delta -= step;
      }
      cursor = (cursor + 1) % chunks.length;
      guard += 1;
      if (chunks.every((chunk) => chunk >= policy.maxSessionMinutes) && delta > 0) return null;
    }
  } else if (delta < 0) {
    let reduction = Math.abs(delta);
    let cursor = chunks.length - 1;
    let guard = 0;
    while (reduction > 0 && guard < 10000) {
      const lowerBound = policy.allowSmallRemainder && cursor === chunks.length - 1
        ? 1
        : policy.minSessionMinutes;
      const reducible = chunks[cursor] - lowerBound;
      if (reducible > 0) {
        const step = Math.min(
          reduction,
          reducible,
          reduction >= 30 && reducible >= 30 ? 30 : reduction,
        );
        chunks[cursor] -= step;
        reduction -= step;
      }
      cursor -= 1;
      if (cursor < 0) cursor = chunks.length - 1;
      guard += 1;
      if (chunks.every((chunk, index) => {
        const lowerBound = policy.allowSmallRemainder && index === chunks.length - 1
          ? 1
          : policy.minSessionMinutes;
        return chunk <= lowerBound;
      }) && reduction > 0) return null;
    }
  }

  const rounded = normalizeChunks(chunks.map(roundToQuantum));
  const roundingDelta = totalMinutes - sum(rounded);
  if (roundingDelta !== 0 && rounded.length > 0) {
    rounded[rounded.length - 1] += roundingDelta;
  }
  return isValidChunkPlan(rounded, totalMinutes, policy) ? normalizeChunks(rounded) : null;
}

function scoreChunkPlan(
  chunks: readonly number[],
  policy: WeeklyPlanningSessionPolicyV5,
  profile: WeeklyPlanningExecutionProfileV5,
): number {
  const heavyTaskScore = profile.cognitiveLoad + profile.contextRetentionCost;
  let score = 0;
  chunks.forEach((chunk, index) => {
    score -= Math.abs(chunk - policy.targetSessionMinutes);
    if (chunk === policy.targetSessionMinutes) score += 28;
    if (policy.mode === 'balanced' && chunk === 60) score += 16;
    if (policy.mode === 'short_focus' && chunk === 60) score += 24;
    if (policy.mode === 'deep_work' && chunk === 120) score += 26;
    if (chunk < policy.minSessionMinutes) {
      score -= policy.allowSmallRemainder && index === chunks.length - 1 ? 24 : 90;
    }
    if (chunk < 30) score -= policy.allowSmallRemainder && index === chunks.length - 1 ? 30 : 120;
    if (heavyTaskScore >= 8 && chunk < 40) score -= 60;
    if (
      chunk === policy.maxSessionMinutes
      && policy.maxSessionMinutes > policy.targetSessionMinutes
      && policy.mode !== 'deep_work'
    ) {
      score -= 45;
    }
    if (policy.mode === 'balanced' && chunk > policy.targetSessionMinutes) {
      score -= (chunk - policy.targetSessionMinutes) * 1.5;
    }
  });
  const smallCount = chunks.filter((chunk) => chunk < policy.minSessionMinutes).length;
  if (smallCount > 1) score -= smallCount * 80;
  const maxHits = chunks.filter((chunk) => chunk === policy.maxSessionMinutes).length;
  if (maxHits > 1 && policy.maxSessionMinutes > policy.targetSessionMinutes && policy.mode !== 'deep_work') {
    score -= maxHits * 35;
  }
  return score - chunks.length * 2;
}

export function splitWeeklyPlanningSessionMinutesV5(params: {
  totalMinutes: number;
  policy: WeeklyPlanningSessionPolicyV5;
  profile: WeeklyPlanningExecutionProfileV5;
}): number[] {
  const total = Math.max(0, Math.round(params.totalMinutes));
  if (total <= 0) return [];
  if (total <= params.policy.maxSessionMinutes) return [total];

  const minCount = Math.max(1, Math.ceil(total / params.policy.maxSessionMinutes));
  const minimumChunkMinutes = params.policy.allowSmallRemainder
    ? 1
    : params.policy.minSessionMinutes;
  const maxCount = Math.max(minCount, Math.ceil(total / minimumChunkMinutes));
  const preferredCount = Math.max(minCount, Math.round(total / params.policy.targetSessionMinutes));
  const counts = new Set<number>([
    minCount,
    preferredCount,
    Math.ceil(total / params.policy.targetSessionMinutes),
    Math.floor(total / params.policy.targetSessionMinutes),
  ]);
  for (let offset = -4; offset <= 4; offset += 1) counts.add(preferredCount + offset);

  const candidates = Array.from(counts)
    .filter((count) => count >= minCount && count <= maxCount)
    .map((count) => candidateForChunkCount(total, count, params.policy))
    .filter((candidate): candidate is number[] => candidate !== null);

  if (candidates.length === 0) {
    const count = Math.max(1, Math.ceil(total / params.policy.maxSessionMinutes));
    const base = Math.floor(total / count);
    const remainder = total % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
      .sort((left, right) => right - left);
  }

  return candidates
    .map((chunks) => ({
      chunks,
      score: scoreChunkPlan(chunks, params.policy, params.profile),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.chunks.length !== right.chunks.length) return left.chunks.length - right.chunks.length;
      return left.chunks.join(',').localeCompare(right.chunks.join(','));
    })[0].chunks;
}

export function isHeavyWeeklyPlanningWorkItemV5(params: {
  graph: WeeklyPlanningExecutionPolicyGraphViewV5;
  item: GenericPlanningWorkItem;
}): boolean {
  const profile = inferWeeklyPlanningExecutionProfileV5(params);
  return profile.cognitiveLoad + profile.contextRetentionCost >= 8;
}
