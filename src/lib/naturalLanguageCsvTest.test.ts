import { describe, expect, it } from 'vitest';
import {
  buildNaturalLanguageCsvCases,
  canRunNaturalLanguageCsvCase,
  compareNaturalLanguageCaseResult,
  parseNaturalLanguageCsv,
} from './naturalLanguageCsvTest';
import type {
  MonthEventRepeat,
  NaturalLanguageSuggestion,
  PlanType,
  RecurrenceRule,
  RecurrenceWeekday,
} from '../types/domain';

const CSV_HEADER = [
  'case_id',
  'input',
  'selected_date',
  'provider',
  'expected_index',
  'expected_title',
  'expected_subject',
  'expected_type',
  'expected_date',
  'expected_start',
  'expected_end',
  'expected_repeat',
  'expected_repeat_kind',
  'expected_repeat_days',
  'expected_excluded_days',
  'expected_repeat_until',
].join(',');

function parseCase(row: string) {
  const cases = buildNaturalLanguageCsvCases(parseNaturalLanguageCsv(`${CSV_HEADER}\n${row}`));
  expect(cases).toHaveLength(1);
  return cases[0];
}

function makeRule(
  weekdays: RecurrenceWeekday[],
  until: string | null,
): RecurrenceRule {
  return {
    id: 'rule-1',
    kind: 'weekday',
    startDate: '2026-04-12',
    until,
    dates: [],
    weekdays,
    dayType: null,
    startTime: '06:30',
    endTime: '07:00',
    title: '英語',
    subject: '英語',
    type: 'study',
    memo: '',
    isOverride: false,
  };
}

function makeSuggestion(options: {
  title?: string;
  subject?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  repeat?: MonthEventRepeat;
  repeatUntil?: string | null;
  type?: PlanType;
  rules?: RecurrenceRule[];
}): NaturalLanguageSuggestion {
  return {
    mode: 'add',
    rawText: '',
    confidence: 1,
    reason: '',
    source: 'rules',
    providerLabel: 'rules',
    status: 'ready',
    parsedPlan: {
      userId: 'user-1',
      title: options.title ?? '英語',
      subject: options.subject ?? '英語',
      date: options.date ?? '2026-04-12',
      startTime: options.startTime ?? '06:30',
      endTime: options.endTime ?? '07:00',
      repeat: options.repeat ?? 'weekly',
      repeatUntil: options.repeatUntil ?? null,
      excludedDates: [],
      recurrenceRules: options.rules ?? [],
      type: options.type ?? 'study',
      memo: '',
    },
    assumptions: [],
    unresolvedFields: [],
    issues: [],
  };
}

function expectPass(row: string, suggestion: NaturalLanguageSuggestion): void {
  const result = compareNaturalLanguageCaseResult(parseCase(row), [suggestion]);
  expect(result.status).toBe('pass');
  expect(result.rowResults[0]?.status).toBe('pass');
}

describe('naturalLanguageCsvTest repeat semantic comparison', () => {
  it('treats structured daily except saturday until as weekly non-saturday until', () => {
    expectPass(
      [
        '512',
        '4月中は毎朝6時半から英語を30分',
        '2026-04-12',
        'rules',
        '1',
        '英語',
        '英語',
        'study',
        '2026-04-12',
        '06:30',
        '07:00',
        'daily_except_sat_until_2026-04-30',
        'daily',
        '',
        'sat',
        '2026-04-30',
      ].join(','),
      makeSuggestion({
        repeatUntil: '2026-04-30',
        rules: [makeRule(['mon', 'tue', 'wed', 'thu', 'fri', 'sun'], '2026-04-30')],
      }),
    );
  });

  it('treats daily_except_wed as weekly mon/tue/thu/fri/sat/sun', () => {
    expectPass(
      [
        '516',
        '他の日は毎日20時から21時で勉強予定',
        '2026-04-12',
        'rules',
        '1',
        '勉強予定',
        '勉強',
        'study',
        '2026-04-12',
        '20:00',
        '21:00',
        'daily_except_wed',
        '',
        '',
        '',
        '',
      ].join(','),
      makeSuggestion({
        title: '勉強予定',
        subject: '勉強',
        startTime: '20:00',
        endTime: '21:00',
        rules: [
          {
            ...makeRule(['mon', 'tue', 'thu', 'fri', 'sat', 'sun'], null),
            startTime: '20:00',
            endTime: '21:00',
            title: '勉強予定',
            subject: '勉強',
          },
        ],
      }),
    );
  });

  it('treats weekends and weekdays_except_tue_fri as equivalent weekly day sets', () => {
    expectPass(
      [
        '901',
        '週末に復習',
        '2026-04-12',
        'rules',
        '1',
        '復習',
        '復習',
        'study',
        '',
        '09:00',
        '10:00',
        'weekends',
        '',
        '',
        '',
        '',
      ].join(','),
      makeSuggestion({
        title: '復習',
        subject: '復習',
        startTime: '09:00',
        endTime: '10:00',
        rules: [
          {
            ...makeRule(['sat', 'sun'], null),
            startTime: '09:00',
            endTime: '10:00',
            title: '復習',
            subject: '復習',
          },
        ],
      }),
    );

    expectPass(
      [
        '902',
        '火金以外の平日に数学',
        '2026-04-12',
        'rules',
        '1',
        '数学',
        '数学',
        'study',
        '',
        '09:00',
        '10:00',
        'weekdays_except_tue_fri',
        '',
        '',
        '',
        '',
      ].join(','),
      makeSuggestion({
        title: '数学',
        subject: '数学',
        startTime: '09:00',
        endTime: '10:00',
        rules: [
          {
            ...makeRule(['mon', 'wed', 'thu'], null),
            startTime: '09:00',
            endTime: '10:00',
            title: '数学',
            subject: '数学',
          },
        ],
      }),
    );
  });

  it('skips case 524 as future_scope outside the main gate', () => {
    const testCase = parseCase(
      [
        '524',
        '今週は数学を合計10時間やりたい',
        '2026-04-12',
        'rules',
        '1',
        '数学',
        '数学',
        'study',
        '',
        '',
        '',
        'none',
        '',
        '',
        '',
        '',
      ].join(','),
    );

    expect(canRunNaturalLanguageCsvCase(testCase, 'rules')).toEqual({
      runnable: false,
      reason: 'future_scope: grouped planning / allocation family はCSV main gate対象外です。',
    });
    expect(compareNaturalLanguageCaseResult(testCase, []).status).toBe('skip');
  });
});
