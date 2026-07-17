#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()
SCOPE = ROOT / "src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts"
TEST = ROOT / "src/features/weeklyPlanning/intake/weeklyPlanningPeriodShortAnswerRegression.test.ts"

text = SCOPE.read_text(encoding="utf-8")

helper_anchor = """function currentTime(context: WeeklyPlanningIntakeContext): string {
  return currentDateTime(context).slice(11, 16) || '00:00';
}

function endDateTimeForDuration(startDate: string, durationDays: number): string | undefined {
"""

helper_replacement = """function currentTime(context: WeeklyPlanningIntakeContext): string {
  return currentDateTime(context).slice(11, 16) || '00:00';
}

type NamedPlanningRangeKind = 'this_week' | 'next_week' | 'weekend';

function inclusiveCalendarDayCount(
  startDate: string,
  endDate: string,
): number | undefined {
  if (!isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate)) {
    return undefined;
  }

  for (let offset = 0; offset <= 14; offset += 1) {
    if (addDays(startDate, offset) === endDate) {
      return offset + 1;
    }
  }

  return undefined;
}

function rangeThroughEndDate(params: {
  context: WeeklyPlanningIntakeContext;
  endDate: string;
  sourceText: string;
  startDate?: string;
  startTime?: string;
}): SetPlanningRangeCommand['range'] | undefined {
  const startDate = params.startDate ?? params.context.selectedDate;
  const calendarDayCount = inclusiveCalendarDayCount(startDate, params.endDate);
  if (!calendarDayCount) return undefined;

  return {
    startDateTime: formatDateTime(
      startDate,
      params.startTime
        ?? (startDate === params.context.selectedDate ? currentTime(params.context) : '00:00'),
    ),
    endDateTime: formatDateTime(params.endDate, '24:00'),
    sourceText: params.sourceText,
    calendarDayCount,
    confidence: 'explicit',
  };
}

function parseNamedPlanningRangeKind(
  text: string,
  expectedSlot?: string,
): NamedPlanningRangeKind | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const directText = stripQuotedSegments(normalizedText).trim();
  const bareMatch = directText.match(
    /^(今週|来週|週末)(?:\\s*(?:です|でお願いします|にします|だって))?$/,
  );
  if (expectedSlot !== 'planning_period' || !bareMatch) {
    return undefined;
  }

  if (/週末/.test(directText)) return 'weekend';
  if (/来週/.test(directText)) return 'next_week';
  if (/今週/.test(directText)) return 'this_week';
  return undefined;
}

function parseNamedPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const kind = parseNamedPlanningRangeKind(text, expectedSlot);
  if (!kind) return undefined;

  const weekStart = startOfWeek(context.selectedDate);
  const thisSunday = addDays(weekStart, 6);

  if (kind === 'next_week') {
    const startDate = addDays(weekStart, 7);
    return rangeThroughEndDate({
      context,
      startDate,
      startTime: '00:00',
      endDate: addDays(startDate, 6),
      sourceText: text,
    });
  }

  if (kind === 'weekend') {
    const saturday = addDays(weekStart, 5);
    const startDate = context.selectedDate > saturday ? context.selectedDate : saturday;
    return rangeThroughEndDate({
      context,
      startDate,
      endDate: thisSunday,
      sourceText: text,
    });
  }

  return rangeThroughEndDate({
    context,
    endDate: thisSunday,
    sourceText: text,
  });
}

function parseSundayBoundPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) return undefined;

  const directText = stripQuotedSegments(normalizedText).trim();
  const hasSundayBoundary =
    /(?:今日\\s*から\\s*)?(?:次の\\s*)?日曜(?:日)?\\s*まで/.test(directText);
  if (!hasSundayBoundary) return undefined;

  const isBareAnswer =
    /^(?:今日\\s*から\\s*)?(?:次の\\s*)?日曜(?:日)?\\s*まで(?:\\s*(?:です|でお願いします))?$/.test(
      directText,
    );
  const isPlanningRequest =
    hasPlanningRequestSignal(directText) && hasSundayBoundary;

  if (
    !(expectedSlot === 'planning_period' ? isBareAnswer || isPlanningRequest : isPlanningRequest)
  ) {
    return undefined;
  }

  const thisSunday = addDays(startOfWeek(context.selectedDate), 6);
  const explicitlyNextSunday = /次の\\s*日曜(?:日)?/.test(directText);
  const endDate =
    explicitlyNextSunday && context.selectedDate === thisSunday
      ? addDays(thisSunday, 7)
      : thisSunday;

  return rangeThroughEndDate({
    context,
    endDate,
    sourceText: text,
  });
}

function endDateTimeForDuration(startDate: string, durationDays: number): string | undefined {
"""

range_anchor = """  const range = parseWeekendPlanningRange(text, context)
    ?? parseWeeklyPlanningRange(
      text,
      context,
      pending,
      expectedSlot,
    );
"""

range_replacement = """  const range = parseNamedPlanningRange(text, context, expectedSlot)
    ?? parseSundayBoundPlanningRange(text, context, expectedSlot)
    ?? parseWeekendPlanningRange(text, context)
    ?? parseWeeklyPlanningRange(
      text,
      context,
      pending,
      expectedSlot,
    );
"""

def replace_exact(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return source.replace(old, new, 1)

if "function parseNamedPlanningRange(" not in text:
    text = replace_exact(text, helper_anchor, helper_replacement, "helper insertion")
    text = replace_exact(text, range_anchor, range_replacement, "range parser wiring")
    SCOPE.write_text(text, encoding="utf-8")

test_content = """import { describe, expect, it } from 'vitest';
import type {
  PlanningIntakeState,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from './weeklyPlanningIntakeReducer';
import { parseSetPlanningRangeCommand } from './weeklyPlanningScopeParsing';

const context: WeeklyPlanningIntakeContext = {
  selectedDate: '2026-07-17',
  currentDateTime: '2026-07-17T16:00:00',
};

function waitingForPlanningPeriod(): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    status: 'needs_scope',
    intent: 'weekly_study_planning',
    missing: ['planning_period', 'tasks_or_goals'],
    lastQuestionContext: {
      kind: 'options',
      topicId: 'planning-range',
      actionId: 'show_options:planning-range:test',
      targetSlot: 'planning_period',
      intent: 'ask_planning_period',
    },
  };
}

describe('weekly planning period short-answer regression', () => {
  it.each([
    ['今週', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['今週です', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['今週でお願いします', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['今週だって', '2026-07-17T16:00:00', '2026-07-19T24:00:00', 3],
    ['来週', '2026-07-20T00:00:00', '2026-07-26T24:00:00', 7],
    ['来週です', '2026-07-20T00:00:00', '2026-07-26T24:00:00', 7],
    ['来週でお願いします', '2026-07-20T00:00:00', '2026-07-26T24:00:00', 7],
    ['週末', '2026-07-18T00:00:00', '2026-07-19T24:00:00', 2],
    ['週末です', '2026-07-18T00:00:00', '2026-07-19T24:00:00', 2],
  ])(
    'accepts the rendered planning-period option %s',
    (text, startDateTime, endDateTime, calendarDayCount) => {
      const command = parseSetPlanningRangeCommand(
        text,
        context,
        undefined,
        'planning_period',
      );

      expect(command?.range).toMatchObject({
        startDateTime,
        endDateTime,
        calendarDayCount,
        confidence: 'explicit',
      });
    },
  );

  it.each([
    '今日から日曜日まで',
    '今日から次の日曜日までです',
    '日曜日まで',
  ])('accepts an explicit Sunday-bound short answer: %s', (text) => {
    const command = parseSetPlanningRangeCommand(
      text,
      context,
      undefined,
      'planning_period',
    );

    expect(command?.range).toMatchObject({
      startDateTime: '2026-07-17T16:00:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 3,
      confidence: 'explicit',
    });
  });

  it('accepts the Sunday boundary in the initial planning request', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '日曜日までの予定を立てて',
      context,
    );

    expect(state.range).toMatchObject({
      startDateTime: '2026-07-17T16:00:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 3,
    });
    expect(state.missing).not.toContain('planning_period');
  });

  it('applies 今週です after the planning-period question and advances the state', () => {
    const state = applyWeeklyPlanningUserTurn(
      waitingForPlanningPeriod(),
      '今週です',
      context,
    );

    expect(state.range).toMatchObject({
      startDateTime: '2026-07-17T16:00:00',
      endDateTime: '2026-07-19T24:00:00',
      calendarDayCount: 3,
    });
    expect(state.missing).not.toContain('planning_period');
  });

  it.each([
    '先生が「今週」と言っていました',
    '「来週です」という例文',
    '週末の予定についての教材',
  ])('does not adopt quoted, reported, or example text: %s', (text) => {
    expect(
      parseSetPlanningRangeCommand(
        text,
        context,
        undefined,
        'planning_period',
      ),
    ).toBeUndefined();
  });
});
"""

if TEST.exists() and TEST.read_text(encoding="utf-8") != test_content:
    raise SystemExit(f"{TEST}: existing content differs")
if not TEST.exists():
    TEST.write_text(test_content, encoding="utf-8")
