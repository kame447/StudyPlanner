import { describe, expect, it } from 'vitest';
import {
  assessWeeklyPlanningRequest,
  parseWeeklyPlanningConditionOperations,
} from '../weeklyPlanningTransforms';
import fc from 'fast-check';

import { extractSimpleWeeklyPlanningTasks } from './weeklyTaskExtraction';

const FUZZ_SEED = 20260623;
const FUZZ_RUNS = 100; // CIで安定したら300へ引き上げる。
const conditionPhrases = ['6日間に分散', '30分台は避けたい', '1日1科目だけは避けたい', '朝は苦手', '夜は使わない', 'この条件で作成'];

describe('weekly parser fuzz', () => {
  it('does not throw or create invalid task amounts for noisy weekly text', () => {
    const textArbitrary = fc.array(
      fc.oneof(
        fc.constantFrom('英語', '数学', '卒研', 'Java実装', 'レポート'),
        fc.integer({ min: 0, max: 600 }).map(String),
        fc.constantFrom('分', '時間', 'やりたい', '来週', '、', '\n', '。', '~', ' '),
        fc.constantFrom(...conditionPhrases),
        fc.string({ minLength: 0, maxLength: 8 }),
      ),
      { minLength: 0, maxLength: 12 },
    ).map((parts) => parts.join(''));

    fc.assert(
      fc.property(textArbitrary, (text) => {
        expect(() => extractSimpleWeeklyPlanningTasks(text)).not.toThrow();
        expect(() => parseWeeklyPlanningConditionOperations(text)).not.toThrow();
        expect(() => assessWeeklyPlanningRequest({ selectedDate: '2026-06-23', text })).not.toThrow();
        const tasks = extractSimpleWeeklyPlanningTasks(text);
        tasks.forEach((task) => {
          expect(task.title.trim().length).toBeGreaterThan(0);
          expect(Number.isNaN(task.durationMinutes)).toBe(false);
          expect(task.durationMinutes).toBeGreaterThanOrEqual(0);
          conditionPhrases.forEach((phrase) => {
            expect(task.title).not.toContain(phrase);
          });
        });
      }),
      { seed: FUZZ_SEED, numRuns: FUZZ_RUNS },
    );
  });

  it('rejects every registered condition-only phrase as a study task', () => {
    conditionPhrases.forEach((text) => {
      expect(extractSimpleWeeklyPlanningTasks(text)).toEqual([]);
    });
  });
});
