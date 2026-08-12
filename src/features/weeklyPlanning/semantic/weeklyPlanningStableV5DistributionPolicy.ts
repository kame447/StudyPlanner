export const WEEKLY_PLANNING_STABLE_V5_NORMAL_WEEK_DAYS = 6;
export const WEEKLY_PLANNING_VOCABULARY_REVIEW_ROUNDS_V5 = 2;

export interface WeeklyPlanningDatePartitionV5 {
  normalDates: string[];
  reserveDates: string[];
}

export interface WeeklyPlanningVocabularyReviewTargetV5 {
  round: 1 | 2;
  offsetDays: number;
  preferredDate: string;
  durationMinutes: number;
}

export function partitionWeeklyPlanningDatesV5(
  dates: readonly string[],
): WeeklyPlanningDatePartitionV5 {
  if (dates.length === 7) {
    return {
      normalDates: dates.slice(0, WEEKLY_PLANNING_STABLE_V5_NORMAL_WEEK_DAYS),
      reserveDates: dates.slice(WEEKLY_PLANNING_STABLE_V5_NORMAL_WEEK_DAYS),
    };
  }
  return {
    normalDates: [...dates],
    reserveDates: [],
  };
}

function distributedBucketIndex(index: number, count: number, bucketCount: number): number {
  if (count <= 0 || bucketCount <= 0) return 0;
  const safeIndex = Math.max(0, Math.min(index, count - 1));
  return Math.min(bucketCount - 1, Math.floor((safeIndex * bucketCount) / count));
}

export function preferredDistributedDateV5(params: {
  index: number;
  count: number;
  dates: readonly string[];
}): string | null {
  const { normalDates } = partitionWeeklyPlanningDatesV5(params.dates);
  if (normalDates.length === 0 || params.count <= 0) return null;
  return normalDates[distributedBucketIndex(params.index, params.count, normalDates.length)] ?? null;
}

export function vocabularyReviewOffsetsV5(dateCount: number): Array<1 | 2 | 3> {
  if (dateCount >= 4) return [1, 3];
  if (dateCount === 3) return [1, 2];
  if (dateCount === 2) return [1];
  return [];
}

export function preferredVocabularyLearningDateV5(params: {
  sessionIndex: number;
  sessionCount: number;
  dates: readonly string[];
}): string | null {
  const { normalDates } = partitionWeeklyPlanningDatesV5(params.dates);
  if (normalDates.length === 0 || params.sessionCount <= 0) return null;
  const offsets = vocabularyReviewOffsetsV5(params.dates.length);
  const maxReviewOffset = offsets.length > 0 ? Math.max(...offsets) : 0;
  const learningBucketCount = Math.max(1, normalDates.length - maxReviewOffset);
  const bucketIndex = distributedBucketIndex(
    params.sessionIndex,
    params.sessionCount,
    learningBucketCount,
  );
  return normalDates[bucketIndex] ?? normalDates[0] ?? null;
}

export function vocabularyLearningCandidateDatesV5(params: {
  preferredDate: string | null;
  dates: readonly string[];
}): string[] {
  const offsets = vocabularyReviewOffsetsV5(params.dates.length);
  const maxReviewOffset = offsets.length > 0 ? Math.max(...offsets) : 0;
  const latestLearningIndex = Math.max(0, params.dates.length - 1 - maxReviewOffset);
  const candidates = params.dates.slice(0, latestLearningIndex + 1);
  if (!params.preferredDate || !candidates.includes(params.preferredDate)) return candidates;
  return [
    params.preferredDate,
    ...candidates.filter((date) => date !== params.preferredDate),
  ];
}

function roundToFive(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

export function vocabularyReviewDurationMinutesV5(
  learningDurationMinutes: number,
  round: 1 | 2,
): number {
  if (!Number.isFinite(learningDurationMinutes) || learningDurationMinutes <= 0) return 0;
  const ratio = round === 1 ? 0.5 : 0.35;
  const minimumReviewMinutes = Math.min(15, learningDurationMinutes);
  return Math.min(
    learningDurationMinutes,
    Math.max(minimumReviewMinutes, roundToFive(learningDurationMinutes * ratio)),
  );
}

export function vocabularyReviewTargetsV5(params: {
  learningDate: string;
  learningDurationMinutes: number;
  dates: readonly string[];
}): WeeklyPlanningVocabularyReviewTargetV5[] {
  const learningIndex = params.dates.indexOf(params.learningDate);
  if (learningIndex < 0) return [];
  return vocabularyReviewOffsetsV5(params.dates.length).flatMap((offset, index) => {
    const preferredDate = params.dates[learningIndex + offset];
    if (!preferredDate) return [];
    const round = (index + 1) as 1 | 2;
    return [{
      round,
      offsetDays: offset,
      preferredDate,
      durationMinutes: vocabularyReviewDurationMinutesV5(
        params.learningDurationMinutes,
        round,
      ),
    }];
  });
}

export function reviewCandidateDatesV5(params: {
  preferredDate: string;
  dates: readonly string[];
}): string[] {
  const preferredIndex = params.dates.indexOf(params.preferredDate);
  if (preferredIndex < 0) return [];
  return params.dates.slice(preferredIndex);
}
