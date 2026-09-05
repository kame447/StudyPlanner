import type {
  WeeklyPlanningExecutionProfileV5,
  WeeklyPlanningSessionPolicyV5,
} from './weeklyPlanningStableV5ExecutionProfile';
import { WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES } from './weeklyPlanningStableV5ExecutionProfile';
import {
  WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5,
} from './weeklyPlanningNumericSafetyV5';

function roundToQuantum(value: number): number {
  return Math.round(value / WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES)
    * WEEKLY_PLANNING_STABLE_V5_SESSION_QUANTUM_MINUTES;
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
  if (
    chunkCount <= 0
    || !Number.isSafeInteger(chunkCount)
    || chunkCount > WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5
  ) return null;
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
  if (!Number.isFinite(params.totalMinutes) || params.totalMinutes <= 0) return [];
  const total = Math.round(params.totalMinutes);
  if (total <= 0) return [];
  if (total <= params.policy.maxSessionMinutes) return [total];

  const minCount = Math.max(1, Math.ceil(total / params.policy.maxSessionMinutes));
  if (
    !Number.isSafeInteger(minCount)
    || minCount > WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5
  ) return [];

  const minimumChunkMinutes = params.policy.allowSmallRemainder
    ? 1
    : params.policy.minSessionMinutes;
  const uncappedMaxCount = Math.max(minCount, Math.ceil(total / minimumChunkMinutes));
  const maxCount = Math.min(
    WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5,
    uncappedMaxCount,
  );
  const preferredCount = Math.max(minCount, Math.round(total / params.policy.targetSessionMinutes));
  const counts = new Set<number>([
    minCount,
    preferredCount,
    Math.ceil(total / params.policy.targetSessionMinutes),
    Math.floor(total / params.policy.targetSessionMinutes),
  ]);
  for (let offset = -4; offset <= 4; offset += 1) counts.add(preferredCount + offset);

  const candidates = Array.from(counts)
    .filter((count) =>
      Number.isSafeInteger(count)
      && count >= minCount
      && count <= maxCount
      && count <= WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5)
    .map((count) => candidateForChunkCount(total, count, params.policy))
    .filter((candidate): candidate is number[] => candidate !== null);

  if (candidates.length === 0) {
    const count = Math.max(1, Math.ceil(total / params.policy.maxSessionMinutes));
    if (
      !Number.isSafeInteger(count)
      || count > WEEKLY_PLANNING_MAX_GENERATED_SESSION_CHUNKS_V5
    ) return [];
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
