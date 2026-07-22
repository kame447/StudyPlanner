import type { SessionChunkPlan, SessionLengthPolicy, StudyTaskProfile } from '../weeklyPlanningTypes';
import { DEFAULT_STUDY_TASK_PROFILE } from '../profiling/studyTaskProfileDefaults';
import { distributeMinutesAcrossBuckets } from './minuteDistribution';

const DEFAULT_MIN_STUDY_BLOCK_MINUTES = 30;

export function normalizeSessionChunkMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes));
}

function roundChunkMinutesToFive(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

function normalizeSessionChunks(chunks: number[]): number[] {
  return chunks
    .map(normalizeSessionChunkMinutes)
    .filter((chunk) => chunk > 0)
    .sort((left, right) => right - left);
}

function sumSessionChunks(chunks: number[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk, 0);
}

function isValidSessionChunkPlan(
  chunks: number[],
  totalMinutes: number,
  policy: SessionLengthPolicy,
): boolean {
  if (chunks.length === 0 || sumSessionChunks(chunks) !== totalMinutes) {
    return false;
  }

  if (chunks.some((chunk) => chunk > policy.maxSessionMinutes || chunk <= 0)) {
    return false;
  }

  const smallChunks = chunks.filter((chunk) => chunk < policy.minSessionMinutes);

  if (smallChunks.length === 0) {
    return true;
  }

  return (
    policy.allowSmallRemainder &&
    smallChunks.length === 1 &&
    chunks[chunks.length - 1] === smallChunks[0]
  );
}

function createTargetFirstSessionCandidate(
  totalMinutes: number,
  policy: SessionLengthPolicy,
): number[] | null {
  const chunks: number[] = [];
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > policy.maxSessionMinutes) {
    const nextChunk = Math.min(policy.targetSessionMinutes, policy.maxSessionMinutes);
    chunks.push(nextChunk);
    remainingMinutes -= nextChunk;
  }

  if (remainingMinutes > 0) {
    chunks.push(remainingMinutes);
  }

  return isValidSessionChunkPlan(chunks, totalMinutes, policy)
    ? normalizeSessionChunks(chunks)
    : null;
}

function createSessionCandidateForChunkCount(
  totalMinutes: number,
  chunkCount: number,
  policy: SessionLengthPolicy,
): number[] | null {
  if (chunkCount <= 0) {
    return null;
  }

  const chunks = Array.from({ length: chunkCount }, () => policy.targetSessionMinutes);
  let deltaMinutes = sumSessionChunks(chunks) - totalMinutes;

  if (deltaMinutes > 0) {
    let cursor = chunks.length - 1;

    while (deltaMinutes > 0) {
      const current = chunks[cursor];
      const lowerBound =
        policy.allowSmallRemainder && cursor === chunks.length - 1
          ? 1
          : policy.minSessionMinutes;
      const reducibleMinutes = current - lowerBound;

      if (reducibleMinutes > 0) {
        const step = Math.min(
          deltaMinutes,
          reducibleMinutes,
          deltaMinutes >= 30 && reducibleMinutes >= 30 ? 30 : deltaMinutes,
        );
        chunks[cursor] -= step;
        deltaMinutes -= step;
      }

      cursor -= 1;

      if (cursor < 0) {
        cursor = chunks.length - 1;
      }

      if (chunks.every((chunk, index) => {
        const lowerBound =
          policy.allowSmallRemainder && index === chunks.length - 1
            ? 1
            : policy.minSessionMinutes;
        return chunk <= lowerBound;
      })) {
        break;
      }
    }
  }

  if (deltaMinutes < 0) {
    let remainingIncrease = Math.abs(deltaMinutes);
    let cursor = 0;

    while (remainingIncrease > 0) {
      const expandableMinutes = policy.maxSessionMinutes - chunks[cursor];

      if (expandableMinutes > 0) {
        const step = Math.min(remainingIncrease, expandableMinutes);
        chunks[cursor] += step;
        remainingIncrease -= step;
      }

      cursor += 1;

      if (cursor >= chunks.length) {
        cursor = 0;
      }

      if (chunks.every((chunk) => chunk >= policy.maxSessionMinutes)) {
        break;
      }
    }

    deltaMinutes = -remainingIncrease;
  }

  const normalizedChunks = normalizeSessionChunks(
    chunks.map(roundChunkMinutesToFive),
  );
  const normalizedDelta = totalMinutes - sumSessionChunks(normalizedChunks);

  if (normalizedDelta !== 0 && normalizedChunks.length > 0) {
    normalizedChunks[normalizedChunks.length - 1] += normalizedDelta;
  }

  return isValidSessionChunkPlan(normalizedChunks, totalMinutes, policy)
    ? normalizeSessionChunks(normalizedChunks)
    : null;
}

function createUserFixedMaxFirstCandidate(
  totalMinutes: number,
  policy: SessionLengthPolicy,
): number[] | null {
  if (!policy.userExplicit && policy.mode !== 'user_fixed') {
    return null;
  }

  const chunks: number[] = [];
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > policy.maxSessionMinutes) {
    chunks.push(policy.maxSessionMinutes);
    remainingMinutes -= policy.maxSessionMinutes;
  }

  if (remainingMinutes > 0) {
    chunks.push(remainingMinutes);
  }

  return isValidSessionChunkPlan(chunks, totalMinutes, policy)
    ? normalizeSessionChunks(chunks)
    : null;
}

export function createSessionChunkCandidates(
  totalMinutes: number,
  policy: SessionLengthPolicy,
): number[][] {
  const normalizedTotalMinutes = normalizeSessionChunkMinutes(totalMinutes);

  if (normalizedTotalMinutes <= 0) {
    return [];
  }

  const minimumChunkMinutes = policy.allowSmallRemainder
    ? 1
    : policy.minSessionMinutes;
  const minChunkCount = Math.max(
    1,
    Math.ceil(normalizedTotalMinutes / policy.maxSessionMinutes),
  );
  const maxChunkCount = Math.max(
    minChunkCount,
    Math.ceil(normalizedTotalMinutes / minimumChunkMinutes),
  );
  const preferredChunkCount = Math.max(
    minChunkCount,
    Math.round(normalizedTotalMinutes / policy.targetSessionMinutes),
  );
  const chunkCounts = new Set<number>([
    minChunkCount,
    preferredChunkCount,
    Math.ceil(normalizedTotalMinutes / policy.targetSessionMinutes),
    Math.floor(normalizedTotalMinutes / policy.targetSessionMinutes),
  ]);

  for (let offset = -4; offset <= 4; offset += 1) {
    chunkCounts.add(preferredChunkCount + offset);
  }

  const candidates = [
    createTargetFirstSessionCandidate(normalizedTotalMinutes, policy),
    createUserFixedMaxFirstCandidate(normalizedTotalMinutes, policy),
    ...Array.from(chunkCounts)
      .filter((chunkCount) => chunkCount >= minChunkCount && chunkCount <= maxChunkCount)
      .map((chunkCount) =>
        createSessionCandidateForChunkCount(
          normalizedTotalMinutes,
          chunkCount,
          policy,
        ),
      ),
  ];
  const uniqueCandidates = new Map<string, number[]>();

  candidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }

    const normalizedCandidate = normalizeSessionChunks(candidate);

    if (!isValidSessionChunkPlan(normalizedCandidate, normalizedTotalMinutes, policy)) {
      return;
    }

    uniqueCandidates.set(normalizedCandidate.join(','), normalizedCandidate);
  });

  return Array.from(uniqueCandidates.values());
}

export function scoreSessionChunkPlan(
  chunks: number[],
  policy: SessionLengthPolicy,
  profile: StudyTaskProfile = DEFAULT_STUDY_TASK_PROFILE,
): SessionChunkPlan {
  const normalizedChunks = normalizeSessionChunks(chunks);
  const heavyTaskScore = profile.cognitiveLoad + profile.contextRetentionCost;
  let score = 0;
  const reasons: string[] = [];

  normalizedChunks.forEach((chunk, index) => {
    const targetDistance = Math.abs(chunk - policy.targetSessionMinutes);
    score -= targetDistance;

    if (chunk === policy.targetSessionMinutes) {
      score += 28;
      reasons.push('target-match');
    }

    if (policy.mode === 'balanced' && chunk === 60) {
      score += 16;
      reasons.push('balanced-remainder');
    }

    if (policy.mode === 'short_focus' && chunk === 60) {
      score += 24;
      reasons.push('short-focus-target');
    }

    if ((policy.mode === 'deep_work' || policy.userExplicit) && chunk === 120) {
      score += 26;
      reasons.push('long-focus-allowed');
    }

    if (chunk < policy.minSessionMinutes) {
      const isAllowedFinalRemainder =
        policy.allowSmallRemainder && index === normalizedChunks.length - 1;
      score -= isAllowedFinalRemainder ? 24 : 90;
      reasons.push(isAllowedFinalRemainder ? 'small-final-remainder' : 'small-block');
    }

    if (chunk < 30) {
      score -= policy.allowSmallRemainder && index === normalizedChunks.length - 1
        ? 30
        : 120;
      reasons.push('tiny-block');
    }

    if (heavyTaskScore >= 8 && chunk < 40) {
      score -= 60;
      reasons.push('heavy-task-short-block');
    }

    if (
      chunk === policy.maxSessionMinutes &&
      policy.maxSessionMinutes > policy.targetSessionMinutes &&
      !policy.userExplicit &&
      policy.mode !== 'deep_work'
    ) {
      score -= 45;
      reasons.push('max-stickiness');
    }

    if (policy.mode === 'balanced' && chunk > policy.targetSessionMinutes) {
      score -= (chunk - policy.targetSessionMinutes) * 1.5;
      reasons.push('balanced-over-target');
    }
  });

  const smallChunks = normalizedChunks.filter(
    (chunk) => chunk < policy.minSessionMinutes,
  );

  if (smallChunks.length > 1) {
    score -= smallChunks.length * 80;
    reasons.push('multiple-small-remainders');
  }

  const maxSessionHits = normalizedChunks.filter(
    (chunk) => chunk === policy.maxSessionMinutes,
  ).length;

  if (
    maxSessionHits > 1 &&
    policy.maxSessionMinutes > policy.targetSessionMinutes &&
    !policy.userExplicit &&
    policy.mode !== 'deep_work'
  ) {
    score -= maxSessionHits * 35;
    reasons.push('repeated-max-sessions');
  }

  score -= normalizedChunks.length * 2;

  return {
    chunks: normalizedChunks,
    score,
    reason: Array.from(new Set(reasons)).join(', ') || 'neutral',
  };
}

export function splitDurationIntoSessionChunks(
  totalMinutes: number,
  policy: SessionLengthPolicy,
  profile: StudyTaskProfile = DEFAULT_STUDY_TASK_PROFILE,
): number[] {
  const normalizedTotalMinutes = normalizeSessionChunkMinutes(totalMinutes);
  const candidates = createSessionChunkCandidates(normalizedTotalMinutes, policy);

  if (candidates.length === 0) {
    if (normalizedTotalMinutes <= 0) {
      return [];
    }

    return distributeMinutesAcrossBuckets(
      normalizedTotalMinutes,
      Math.max(1, Math.ceil(normalizedTotalMinutes / policy.maxSessionMinutes)),
    );
  }

  return candidates
    .map((chunks) => scoreSessionChunkPlan(chunks, policy, profile))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (left.chunks.length !== right.chunks.length) {
        return left.chunks.length - right.chunks.length;
      }

      return left.chunks.join(',').localeCompare(right.chunks.join(','));
    })[0].chunks;
}


export function splitDurationIntoDraftBlockMinutesWithMax(
  durationMinutes: number,
  maxSessionMinutes: number,
  minSessionMinutes = DEFAULT_MIN_STUDY_BLOCK_MINUTES,
): number[] {
  const blockMinutes: number[] = [];
  let remainingMinutes = durationMinutes;
  const safeMaxSessionMinutes = Math.max(30, maxSessionMinutes);
  const safeMinSessionMinutes = Math.max(1, minSessionMinutes);

  while (remainingMinutes > 0) {
    if (
      remainingMinutes > safeMaxSessionMinutes &&
      remainingMinutes - safeMaxSessionMinutes < safeMinSessionMinutes
    ) {
      const firstMinutes = Math.ceil(remainingMinutes / 20) * 10;
      blockMinutes.push(firstMinutes);
      blockMinutes.push(remainingMinutes - firstMinutes);
      remainingMinutes = 0;
      break;
    }

    const nextMinutes = Math.min(remainingMinutes, safeMaxSessionMinutes);
    blockMinutes.push(nextMinutes);
    remainingMinutes -= nextMinutes;
  }

  return blockMinutes;
}


