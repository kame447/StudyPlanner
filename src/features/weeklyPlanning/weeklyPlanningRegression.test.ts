import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningConditionOverride,
  assessWeeklyPlanningRequest,
  createWeeklyPlanningPendingConfig,
  parseWeeklyPlanningConditionOperations,
} from './weeklyPlanningTransforms';

describe('weeklyPlanningRegression', () => {

  it('normalizes day-count variants into setDayCount operations', () => {
    [
      ['七日間で', 7],
      ['７日間で', 7],
      ['7日間で', 7],
      ['七日で', 7],
    ].forEach(([text, dayCount]) => {
      expect(parseWeeklyPlanningConditionOperations(String(text))).toContainEqual({
        kind: 'setDayCount',
        dayCount,
      });
    });
  });

  it('extracts all operations from the manual multiline condition reply', () => {
    expect(
      parseWeeklyPlanningConditionOperations(
        '七日間で\n睡眠は2:00~9:00\nお昼ご飯は13:00~14:00\n夜ごはんは20:00~21:00で',
      ),
    ).toEqual([
      { kind: 'setDayCount', dayCount: 7 },
      { kind: 'setSleepWindow', startTime: '02:00', endTime: '09:00' },
      {
        kind: 'addUnavailableRange',
        startTime: '13:00',
        endTime: '14:00',
        reason: '昼食',
      },
      {
        kind: 'addUnavailableRange',
        startTime: '20:00',
        endTime: '21:00',
        reason: '夕食',
      },
    ]);
  });

  it('applies all operations from the manual multiline condition reply', () => {
    const sourceText = '来週、英語を2時間やりたい';
    const assessment = assessWeeklyPlanningRequest({
      selectedDate: '2026-06-19',
      text: sourceText,
    });
    const pendingConfig = createWeeklyPlanningPendingConfig({ sourceText, assessment });
    const override = applyWeeklyPlanningConditionOverride({
      config: pendingConfig,
      text: '七日間で\n睡眠は2:00~9:00\nお昼ご飯は13:00~14:00\n夜ごはんは20:00~21:00で',
    });

    expect(override.kind).toBe('updated');
    if (override.kind !== 'updated') return;
    expect(override.config.defaults).toMatchObject({
      dayCount: 7,
      sleepStartTime: '02:00',
      wakeTime: '09:00',
    });
    expect(override.config.defaults.availableStudyRanges).toEqual([
      expect.objectContaining({ startTime: '09:00', endTime: '24:00' }),
    ]);
    expect(override.config.defaults.unavailableRanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startTime: '13:00',
          endTime: '14:00',
          reason: '昼食',
        }),
        expect.objectContaining({
          startTime: '20:00',
          endTime: '21:00',
          reason: '夕食',
        }),
      ]),
    );
  });

  it('classifies meal and unavailable time ranges from surrounding words', () => {
    [
      ['お昼ご飯は13:00~14:00', '昼食'],
      ['昼食は13:00~14:00', '昼食'],
      ['ランチは13:00~14:00', '昼食'],
      ['夜ごはんは20:00~21:00', '夕食'],
      ['夕食は20:00~21:00', '夕食'],
      ['13:00-14:00 は使わない', '使用不可'],
      ['20:00-21:00 は空けて', '使用不可'],
    ].forEach(([text, reason]) => {
      const operations = parseWeeklyPlanningConditionOperations(String(text));

      expect(operations).toEqual([
        expect.objectContaining({
          kind: 'addUnavailableRange',
          reason,
        }),
      ]);
    });
  });
});
