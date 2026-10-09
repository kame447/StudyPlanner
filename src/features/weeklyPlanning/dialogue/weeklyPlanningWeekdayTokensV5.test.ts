import { describe, expect, it } from 'vitest';
import { weekdaysNamedInTextV5, weekdaysSubsetOfRecordV5 } from './weeklyPlanningWeekdayTokensV5';

const MON = 1, TUE = 2, WED = 3, THU = 4;

describe('weekday token subset (closed set, both ways)', () => {
  it('「月曜と水曜」 against a Tuesday/Thursday record fails', () => {
    expect(weekdaysSubsetOfRecordV5('月曜と水曜の夜に1時間ずつ', [TUE, THU])).toBe(false);
  });
  it('「月・水」 against a Monday/Wednesday record passes (separator list)', () => {
    expect(weekdaysSubsetOfRecordV5('月・水の夜に1時間ずつ', [MON, WED])).toBe(true);
    expect([...weekdaysNamedInTextV5('月・水')].sort()).toEqual([MON, WED]);
  });
  it('a subset passes, an extra weekday fails, naming none passes', () => {
    expect(weekdaysSubsetOfRecordV5('火曜に1時間', [TUE, THU])).toBe(true);
    expect(weekdaysSubsetOfRecordV5('火曜と金曜に1時間', [TUE, THU])).toBe(false);
    expect(weekdaysSubsetOfRecordV5('今週は2回、1時間ずつです', [TUE, THU])).toBe(true);
  });
  it('「火、木曜」 and 「火曜日」 are read; month/day/every-day words are not weekdays', () => {
    expect([...weekdaysNamedInTextV5('火、木曜')].sort()).toEqual([TUE, THU]);
    expect([...weekdaysNamedInTextV5('火曜日')]).toEqual([TUE]);
    for (const text of ['来月の予定', '9月1日に', '毎日少しずつ', '日本語の勉強', '月に2回']) {
      expect([...weekdaysNamedInTextV5(text)], text).toEqual([]);
    }
  });
});
