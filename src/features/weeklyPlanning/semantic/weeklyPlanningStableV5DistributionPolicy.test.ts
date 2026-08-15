import { describe, expect, it } from 'vitest';
import {
  distributeDiscreteQuantityAcrossWeeklyBucketsV5,
  distributeMinutesAcrossWeeklyBucketsV5,
  partitionWeeklyPlanningDatesV5,
  preferredDistributedDateV5,
  preferredVocabularyLearningDateV5,
  preferredVocabularyLearningDaypartV5,
  preferredVocabularyReviewDaypartV5,
  resolveWeeklySpreadSessionCountV5,
  reviewCandidateDatesV5,
  vocabularyLearningCandidateDatesV5,
  vocabularyReviewDurationMinutesV5,
  vocabularyReviewOffsetsV5,
  vocabularyReviewTargetsV5,
} from './weeklyPlanningStableV5DistributionPolicy';

const WEEK = [
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
];

describe('Stable V5 distribution policy migrated from the legacy weekly scheduler', () => {
  it('keeps the first six days as normal placement days and the seventh as reserve', () => {
    expect(partitionWeeklyPlanningDatesV5(WEEK)).toEqual({
      normalDates: WEEK.slice(0, 6),
      reserveDates: [WEEK[6]],
    });
  });

  it('assigns ordinary daily quotas to consecutive normal days like the legacy scheduler', () => {
    expect([0, 1, 2].map((index) => preferredDistributedDateV5({
      index,
      count: 3,
      dates: WEEK,
    }))).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
  });

  it('derives daily quota count and preserves both minutes and discrete quantity', () => {
    expect(resolveWeeklySpreadSessionCountV5({ totalMinutes: 180, dates: WEEK })).toBe(3);
    expect(resolveWeeklySpreadSessionCountV5({ totalMinutes: 330, dates: WEEK })).toBe(5);
    expect(resolveWeeklySpreadSessionCountV5({ totalMinutes: 720, dates: WEEK })).toBe(6);
    expect(distributeMinutesAcrossWeeklyBucketsV5(330, 5)).toEqual([70, 65, 65, 65, 65]);
    expect(distributeDiscreteQuantityAcrossWeeklyBucketsV5(40, 5)).toEqual([8, 8, 8, 8, 8]);
    expect(distributeDiscreteQuantityAcrossWeeklyBucketsV5(41, 5)).toEqual([9, 8, 8, 8, 8]);
  });

  it('front-loads vocabulary learning but keeps later dates as graceful fallback capacity', () => {
    expect([0, 1, 2].map((sessionIndex) => preferredVocabularyLearningDateV5({
      sessionIndex,
      sessionCount: 3,
      dates: WEEK,
    }))).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
    expect(vocabularyLearningCandidateDatesV5({
      preferredDate: '2026-08-19',
      dates: WEEK,
    })).toEqual([
      '2026-08-19',
      '2026-08-17',
      '2026-08-18',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('spreads vocabulary learning across morning, midday and night without forcing extra sessions', () => {
    expect(preferredVocabularyLearningDaypartV5({ sessionIndex: 0, sessionCount: 1 })).toBe('morning');
    expect([0, 1].map((sessionIndex) => preferredVocabularyLearningDaypartV5({
      sessionIndex,
      sessionCount: 2,
    }))).toEqual(['morning', 'night']);
    expect([0, 1, 2].map((sessionIndex) => preferredVocabularyLearningDaypartV5({
      sessionIndex,
      sessionCount: 3,
    }))).toEqual(['morning', 'afternoon', 'night']);
    expect(preferredVocabularyReviewDaypartV5(1)).toBe('night');
    expect(preferredVocabularyReviewDaypartV5(2)).toBe('morning');
  });

  it('creates next-day and three-days-later reviews with shorter deterministic durations', () => {
    expect(vocabularyReviewOffsetsV5(WEEK.length)).toEqual([1, 3]);
    expect(vocabularyReviewDurationMinutesV5(30, 1)).toBe(15);
    expect(vocabularyReviewDurationMinutesV5(30, 2)).toBe(15);
    expect(vocabularyReviewDurationMinutesV5(35, 1)).toBe(20);
    expect(vocabularyReviewDurationMinutesV5(35, 2)).toBe(15);
    expect(vocabularyReviewDurationMinutesV5(10, 1)).toBe(10);
    expect(vocabularyReviewTargetsV5({
      learningDate: '2026-08-19',
      learningDurationMinutes: 30,
      dates: WEEK,
    })).toEqual([
      { round: 1, offsetDays: 1, preferredDate: '2026-08-20', durationMinutes: 15 },
      { round: 2, offsetDays: 3, preferredDate: '2026-08-22', durationMinutes: 15 },
    ]);
    expect(reviewCandidateDatesV5({
      preferredDate: '2026-08-22',
      dates: WEEK,
    })).toEqual(['2026-08-22', '2026-08-23']);
  });

  it('degrades review spacing deterministically for shorter planning horizons', () => {
    const threeDays = WEEK.slice(0, 3);
    expect(vocabularyReviewOffsetsV5(threeDays.length)).toEqual([1, 2]);
    expect(vocabularyReviewTargetsV5({
      learningDate: threeDays[0],
      learningDurationMinutes: 30,
      dates: threeDays,
    }).map((target) => target.preferredDate)).toEqual([
      threeDays[1],
      threeDays[2],
    ]);
    expect(vocabularyReviewOffsetsV5(2)).toEqual([1]);
    expect(vocabularyReviewOffsetsV5(1)).toEqual([]);
  });
});
