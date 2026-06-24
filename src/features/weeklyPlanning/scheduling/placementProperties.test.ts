import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import {
  assessWeeklyPlanningRequest,
  createAvailabilityAwareWeeklyDraftBlocksFromText,
  createWeeklyPlanningPendingConfig,
} from '../weeklyPlanningTransforms';
import {
  expectNoInvalidBlocks,
  expectNoSameDayTitleReentry,
  expectNoUnavailableOverlaps,
  expectTotalMinutesPreserved,
  findUnexplainedSameTitleGaps,
  hasOverlapWithExistingPlans,
  minutesFromClock,
} from '../testUtils/weeklyPlanningTestHelpers';
import fc from 'fast-check';



const SELECTED_DATE = '2026-06-23';
const PROPERTY_SEED = 20260623;
const PROPERTY_RUNS = 100; // CIで安定したら300へ引き上げる。

function addDaysIso(date: string, days: number): string {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function timeFromHour(hour: number): string {
  return String(hour).padStart(2, '0') + ':00';
}

function timeFromMinutes(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

function makeExistingPlan(params: {
  index: number;
  date: string;
  startHour: number;
  durationMinutes: number;
}): Plan {
  return {
    id: 'existing-' + params.index,
    seriesId: 'series-property',
    userId: 'user-1',
    title: '既存予定',
    subject: '既存予定',
    date: params.date,
    startTime: timeFromHour(params.startHour),
    endTime: timeFromMinutes(params.startHour * 60 + params.durationMinutes),
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
  };
}

describe('weekly placement properties', () => {
  it('preserves placement invariants across small generated scenarios', () => {
    const scenarioArbitrary = fc
      .record({
        taskDurations: fc.array(
          fc.integer({ min: 1, max: 20 }).map((value) => value * 30),
          { minLength: 1, maxLength: 5 },
        ),
        dayCount: fc.integer({ min: 1, max: 7 }),
        availableStartHour: fc.integer({ min: 8, max: 12 }),
        availableEndHour: fc.integer({ min: 18, max: 24 }),
        breakMinutes: fc.constantFrom(0, 10, 15),
        bufferMinutes: fc.constantFrom(0, 15, 30),
        maxSessionMinutes: fc.constantFrom(60, 90, 120),
        avoidTinyChunks: fc.boolean(),
        existingPlans: fc.array(
          fc.record({
            dateIndex: fc.integer({ min: 0, max: 6 }),
            startHour: fc.integer({ min: 9, max: 20 }),
            durationMinutes: fc.constantFrom(30, 60, 90),
          }),
          { minLength: 0, maxLength: 2 },
        ),
      })
      .filter(
        (scenario) =>
          scenario.availableStartHour < scenario.availableEndHour &&
          scenario.taskDurations.every(
            (duration) => duration <= scenario.dayCount * scenario.maxSessionMinutes,
          ) &&
          (!scenario.avoidTinyChunks ||
            scenario.taskDurations.every(
              (duration) => duration % scenario.maxSessionMinutes !== 30,
            )),
      );

    fc.assert(
      fc.property(scenarioArbitrary, (scenario) => {
        const sourceText = '来週、' + scenario.taskDurations
          .map((duration, index) => '科目' + (index + 1) + 'を' + duration + '分')
          .join('、') + 'やりたい';
        const assessment = assessWeeklyPlanningRequest({ selectedDate: SELECTED_DATE, text: sourceText });
        const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
        const startDate = pendingConfig.defaults.startDate;
        const defaults = {
          ...pendingConfig.defaults,
          dayCount: scenario.dayCount,
          reserveDate: addDaysIso(startDate, scenario.dayCount),
          breakMinutes: scenario.breakMinutes,
          bufferMinutes: scenario.bufferMinutes,
          maxSessionMinutes: scenario.maxSessionMinutes,
          availableStudyRanges: [{ startTime: timeFromHour(scenario.availableStartHour), endTime: timeFromHour(scenario.availableEndHour), reason: 'property-generated' }],
          preferredStudyRanges: [{ startTime: timeFromHour(scenario.availableStartHour), endTime: timeFromHour(scenario.availableEndHour), reason: 'property-generated' }],
          unavailableRanges: scenario.availableStartHour < 12 && scenario.availableEndHour > 13 ? [{ startTime: '12:00', endTime: '13:00', reason: '昼食' }] : [],
        };
        const existingPlans = scenario.existingPlans.map((existingPlan, index) => makeExistingPlan({
          index,
          date: addDaysIso(startDate, existingPlan.dateIndex % scenario.dayCount),
          startHour: existingPlan.startHour,
          durationMinutes: existingPlan.durationMinutes,
        }));
        const result = createAvailabilityAwareWeeklyDraftBlocksFromText({
          userId: 'user-1',
          selectedDate: SELECTED_DATE,
          text: 'この条件で作成',
          existingPlans,
          allowPartialPlacement: true,
          pendingConfig: { ...pendingConfig, defaults, qualityPreferences: scenario.avoidTinyChunks ? ['avoidTinyChunks'] : [] },
        });
        const requestedMinutes = scenario.taskDurations.reduce((sum, duration) => sum + duration, 0);

        expectTotalMinutesPreserved(result, requestedMinutes);
        expectNoInvalidBlocks(result.blocks);
        expectNoUnavailableOverlaps(result.blocks, { unavailableRanges: defaults.unavailableRanges });
        expect(hasOverlapWithExistingPlans(result.blocks, existingPlans, defaults.bufferMinutes)).toBe(false);
        if (existingPlans.length === 0) {
          expectNoSameDayTitleReentry(result.blocks);
        }
        result.blocks.forEach((block) => {
          const startMinutes = minutesFromClock(block.startTime);
          const endMinutes = minutesFromClock(block.endTime);
          const insideAvailableRange = defaults.availableStudyRanges.some((range) => startMinutes >= minutesFromClock(range.startTime) && endMinutes <= minutesFromClock(range.endTime));
          expect(insideAvailableRange).toBe(true);
        });
        if (existingPlans.length === 0) {
          expect(findUnexplainedSameTitleGaps(result.blocks, { breakMinutes: defaults.breakMinutes + 120, unavailableRanges: defaults.unavailableRanges })).toEqual([]);
        }
        if (scenario.avoidTinyChunks && scenario.taskDurations.every((duration) => duration >= 60)) {
          expect(result.blocks.some((block) => {
            const duration = minutesFromClock(block.endTime) - minutesFromClock(block.startTime);
            return duration >= 30 && duration < 40;
          })).toBe(false);
        }
      }),
      { seed: PROPERTY_SEED, numRuns: PROPERTY_RUNS },
    );
  });
});
