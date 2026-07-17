from pathlib import Path
import re

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# 1. Domain contract: an end boundary may be known before the start point.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningIntakeTypes.ts'
text = read(path)
text = replace_once(
    text,
    "  planningStartDate?: string;\n  durationDays?: number;\n  sourceText: string;",
    "  planningStartDate?: string;\n  planningStartDateTime?: string;\n  planningEndDateTime?: string;\n  durationDays?: number;\n  sourceText: string;",
    'intake pending fields',
)
write(path, text)

path = 'src/features/weeklyPlanning/intake/weeklyPlanningCommandTypes.ts'
text = read(path)
text = replace_once(
    text,
    "  planningStartDate?: string;\n  durationDays?: number;\n  sourceText: string;",
    "  planningStartDate?: string;\n  planningStartDateTime?: string;\n  planningEndDateTime?: string;\n  durationDays?: number;\n  sourceText: string;",
    'command pending fields',
)
write(path, text)

# 2. Runtime command validation.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts'
text = read(path)
text = replace_once(
    text,
    "if (!hasOnlyKeys(pending, ['scope', 'planningStartDate', 'durationDays', 'sourceText'])",
    "if (!hasOnlyKeys(pending, ['scope', 'planningStartDate', 'planningStartDateTime', 'planningEndDateTime', 'durationDays', 'sourceText'])",
    'runtime allowed pending keys',
)
text = replace_once(
    text,
    "        || !isOptionalString(pending.planningStartDate)\n        || (pending.durationDays !== undefined",
    "        || !isOptionalString(pending.planningStartDate)\n        || !isOptionalString(pending.planningStartDateTime)\n        || !isOptionalString(pending.planningEndDateTime)\n        || (pending.durationDays !== undefined",
    'runtime optional pending datetime fields',
)
text = replace_once(
    text,
    "      if (pending.planningStartDate !== undefined\n        && pending.durationDays !== undefined) return false;",
    "      if (pending.planningStartDate !== undefined\n        && pending.planningStartDateTime !== undefined) return false;\n      if ((pending.planningStartDate !== undefined || pending.planningStartDateTime !== undefined)\n        && pending.durationDays !== undefined) return false;\n      if (pending.planningStartDateTime !== undefined\n        && !/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$/.test(pending.planningStartDateTime)) return false;\n      if (pending.planningEndDateTime !== undefined\n        && !/^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-4]):[0-5]\\d:[0-5]\\d$/.test(pending.planningEndDateTime)) return false;\n      if (pending.planningStartDateTime !== undefined\n        && pending.planningEndDateTime !== undefined) return false;",
    'runtime pending completeness guard',
)
write(path, text)

# 3. Reducer missing-slot derivation.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningIntakeReducer.ts'
text = read(path)
text = replace_once(
    text,
    "        ...(!command.pending.planningStartDate\n          ? ['planning_start_date' as const]\n          : []),\n        ...(command.pending.durationDays === undefined\n          ? ['planning_duration' as const]\n          : []),",
    "        ...(!command.pending.planningStartDate && !command.pending.planningStartDateTime\n          ? ['planning_start_date' as const]\n          : []),\n        ...(command.pending.planningEndDateTime === undefined\n          && command.pending.durationDays === undefined\n          ? ['planning_duration' as const]\n          : []),",
    'reducer pending missing slots',
)
write(path, text)

# 4. Ask for an arbitrary start point when only the end is fixed.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts'
text = read(path)
text = replace_once(
    text,
    "    const scopeLabel = state.pendingPlanningRange?.scope.label ?? 'その期間';\n    return `${scopeLabel}のどの日から計画を始めますか？`;",
    "    const pending = state.pendingPlanningRange;\n    if (pending?.planningEndDateTime) {\n      return `${pending.scope.label}の予定ですね。いつから始めますか？今すぐ、明日から、または別の開始時刻を指定できます。`;\n    }\n    const scopeLabel = pending?.scope.label ?? 'その期間';\n    return `${scopeLabel}のどの日から計画を始めますか？`;",
    'deterministic start question',
)
text = replace_once(
    text,
    "    '計画を始める日です。質問中の期間内で、開始したい曜日や日付を教えてください。',",
    "    '計画を始める日時です。質問中の終了時点より前で、今すぐ、何時間後、曜日、日付、時刻などを指定できます。',",
    'start term explanation',
)
text = replace_once(
    text,
    "  vocabularyHint: '計画を始める日(質問中の期間内の曜日や日付)',",
    "  vocabularyHint: '計画を始める日時(今すぐ、相対時間、曜日、日付、時刻)',",
    'start vocabulary hint',
)
write(path, text)

# 5. Parser semantics.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts'
text = read(path)

old_block = re.search(
    r"function parseSundayBoundPlanningRange\([\s\S]*?\n}\n\nfunction endDateTimeForDuration",
    text,
)
if not old_block:
    raise RuntimeError('Sunday-bound parser block not found')
new_block = r'''function sundayBoundaryEndDate(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string | undefined {
  const normalizedText = normalizeIntakeText(text);
  if (hasReportedOrExampleContext(normalizedText)) return undefined;
  const directText = stripQuotedSegments(normalizedText).trim();
  if (!/(?:次の\s*)?日曜(?:日)?\s*まで/.test(directText)) return undefined;

  const thisSunday = addDays(startOfWeek(context.selectedDate), 6);
  return /次の\s*日曜(?:日)?/.test(directText) && context.selectedDate === thisSunday
    ? addDays(thisSunday, 7)
    : thisSunday;
}

function addMinutesToDateTime(dateTime: string, minutes: number): string | undefined {
  const match = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}$/);
  if (!match || !Number.isFinite(minutes)) return undefined;
  const value = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]) + minutes,
  ));
  if (Number.isNaN(value.getTime())) return undefined;
  return value.toISOString().slice(0, 19);
}

function parseFlexiblePlanningStartDateTime(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): string | undefined {
  const normalizedText = normalizeIntakeText(text).trim();
  if (blocksStartDateAnswer(normalizedText)) return undefined;
  const directText = stripQuotedSegments(normalizedText).trim();
  const isExpectedAnswer = expectedSlot === 'planning_start_date';
  const hasStartMarker = /(?:から|開始|始め)/.test(directText);
  if (!isExpectedAnswer && !hasStartMarker) return undefined;

  if (/^(?:今すぐ|すぐ)(?:から)?(?:です|でお願いします)?$/.test(directText)) {
    return currentDateTime(context);
  }

  const relativeMatch = directText.match(/^([0-9]+|[一二三四五六七八九十]+)\s*(時間|分)\s*後(?:から)?(?:です|でお願いします)?$/);
  if (relativeMatch) {
    const amount = parseSmallInteger(relativeMatch[1]);
    if (!amount) return undefined;
    return addMinutesToDateTime(currentDateTime(context), relativeMatch[2] === '時間' ? amount * 60 : amount);
  }

  const dayOffset = /明後日/.test(directText) ? 2 : /明日/.test(directText) ? 1 : /今日/.test(directText) ? 0 : undefined;
  const explicitDate = parseExplicitDate(directText, context);
  const date = explicitDate ?? (dayOffset === undefined ? undefined : addDays(context.selectedDate, dayOffset));
  if (date) {
    const hourMatch = directText.match(/(\d{1,2})\s*時(?:\s*(半))?/);
    const minuteMatch = directText.match(/(\d{1,2})\s*時\s*(\d{1,2})\s*分/);
    const time = minuteMatch
      ? `${String(Number(minuteMatch[1])).padStart(2, '0')}:${String(Number(minuteMatch[2])).padStart(2, '0')}`
      : hourMatch
        ? `${String(Number(hourMatch[1])).padStart(2, '0')}:${hourMatch[2] ? '30' : '00'}`
        : /朝/.test(directText)
          ? '08:00'
          : date === context.selectedDate
            ? currentTime(context)
            : '00:00';
    return formatDateTime(date, time);
  }

  const weekdayIndex = parseWeekdayStart(directText);
  if (weekdayIndex !== undefined) {
    const scope = {
      kind: 'named_future_period' as const,
      label: '指定期間',
      windowStartDate: context.selectedDate,
      windowEndDate: addDays(context.selectedDate, 7),
    };
    const weekdayDate = resolveWeekdayInScope(weekdayIndex, scope);
    return weekdayDate ? formatDateTime(weekdayDate, '00:00') : undefined;
  }

  return undefined;
}

function parseSundayBoundPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): SetPlanningRangeCommand['range'] | undefined {
  const endDate = sundayBoundaryEndDate(text, context);
  if (!endDate) return undefined;
  const normalizedText = normalizeIntakeText(text);
  const directText = stripQuotedSegments(normalizedText).trim();
  const explicitStartText = directText.match(/^(.+?から).*日曜(?:日)?\s*まで/)?.[1];
  if (!explicitStartText) return undefined;
  const startDateTime = parseFlexiblePlanningStartDateTime(explicitStartText, context, expectedSlot ?? 'planning_start_date');
  if (!startDateTime) return undefined;
  const endDateTime = formatDateTime(endDate, '24:00');
  if (startDateTime > endDateTime) return undefined;
  const calendarDayCount = inclusiveCalendarDayCount(startDateTime.slice(0, 10), endDate);
  if (!calendarDayCount) return undefined;
  return {
    startDateTime,
    endDateTime,
    sourceText: text,
    calendarDayCount,
    confidence: 'explicit',
  };
}

function parseSundayBoundPendingPlanningRange(
  text: string,
  context: WeeklyPlanningIntakeContext,
  expectedSlot?: string,
): NormalizedSetPendingPlanningRangeCommand | undefined {
  const endDate = sundayBoundaryEndDate(text, context);
  if (!endDate) return undefined;
  const normalizedText = normalizeIntakeText(text);
  const directText = stripQuotedSegments(normalizedText).trim();
  const isBareAnswer = /^(?:次の\s*)?日曜(?:日)?\s*まで(?:\s*(?:です|でお願いします))?$/.test(directText);
  const isPlanningRequest = hasPlanningRequestSignal(directText);
  if (!(isPlanningRequest || (expectedSlot === 'planning_period' && isBareAnswer))) return undefined;
  if (/^.+?から.*日曜(?:日)?\s*まで/.test(directText)) return undefined;

  return {
    type: 'set_pending_planning_range',
    pending: {
      scope: {
        kind: 'named_future_period',
        label: '日曜日まで',
        windowStartDate: context.selectedDate,
        windowEndDate: endDate,
      },
      planningEndDateTime: formatDateTime(endDate, '24:00'),
      sourceText: text,
    },
    sourceText: text,
    confidence: 'high',
  };
}

function endDateTimeForDuration'''
text = text[:old_block.start()] + new_block + text[old_block.end():]

# Complete a fixed-end pending range from a flexible start answer.
needle = "  if (pending) {\n    const durationDays = acceptsDurationAnswer(text, expectedSlot)"
replacement = """  if (pending) {
    if (pending.planningEndDateTime) {
      const startDateTime = parseFlexiblePlanningStartDateTime(text, context, expectedSlot);
      if (!startDateTime || startDateTime > pending.planningEndDateTime) return undefined;
      const calendarDayCount = inclusiveCalendarDayCount(
        startDateTime.slice(0, 10),
        pending.planningEndDateTime.slice(0, 10),
      );
      if (!calendarDayCount) return undefined;
      return {
        startDateTime,
        endDateTime: pending.planningEndDateTime,
        sourceText: text,
        calendarDayCount,
        confidence: 'explicit',
      };
    }

    const durationDays = acceptsDurationAnswer(text, expectedSlot)"""
text = replace_once(text, needle, replacement, 'fixed-end pending completion')

# Produce end-only pending before generic pending parsing.
needle = "  const normalizedText = normalizeIntakeText(text);\n  const currentPending = options?.pending;"
replacement = """  const normalizedText = normalizeIntakeText(text);
  const currentPending = options?.pending;
  if (!currentPending) {
    const sundayBoundPending = parseSundayBoundPendingPlanningRange(
      text,
      context,
      options?.expectedSlot,
    );
    if (sundayBoundPending) return sundayBoundPending;
  }"""
text = replace_once(text, needle, replacement, 'Sunday pending dispatch')
write(path, text)

# 6. AI schema and instruction can represent the same pending contract.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts'
text = read(path)
text = replace_once(
    text,
    "          planningStartDate: stringSchema(),\n          durationDays: integerSchema(),",
    "          planningStartDate: stringSchema(),\n          planningStartDateTime: stringSchema(),\n          planningEndDateTime: stringSchema(),\n          durationDays: integerSchema(),",
    'AI pending schema fields',
)
text = replace_once(
    text,
    "pending.planningStartDate is only the start date selected by the user. pending.durationDays is only the requested plan length.",
    "pending.planningStartDate is only a date-only start. pending.planningStartDateTime is an explicitly selected start timestamp. pending.planningEndDateTime is an explicitly fixed end boundary. pending.durationDays is only the requested plan length.",
    'AI pending contract prompt',
)
text = replace_once(
    text,
    "Emit set_planning_range only when both pending.planningStartDate and pending.durationDays are known and the selected start date satisfies the pending window.",
    "Emit set_planning_range when either start plus duration are known, or startDateTime plus endDateTime are known, and the selected start satisfies the pending window and precedes the end.",
    'AI range completion prompt',
)
write(path, text)

# 7. Regression tests: encode the user-observed trace and flexible starts.
path = 'src/features/weeklyPlanning/intake/weeklyPlanningPeriodShortAnswerRegression.test.ts'
write(path, '''import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { applyWeeklyPlanningUserTurn, createInitialPlanningIntakeState } from './weeklyPlanningIntakeReducer';
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
      kind: 'options', topicId: 'planning-range', actionId: 'show_options:planning-range:test',
      targetSlot: 'planning_period', intent: 'ask_planning_period',
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
    ['週末', '2026-07-18T00:00:00', '2026-07-19T24:00:00', 2],
  ])('accepts the rendered option %s', (text, startDateTime, endDateTime, calendarDayCount) => {
    expect(parseSetPlanningRangeCommand(text, context, undefined, 'planning_period')?.range)
      .toMatchObject({ startDateTime, endDateTime, calendarDayCount, confidence: 'explicit' });
  });

  it('keeps Sunday as an end boundary and asks only for the start point', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '日曜日までの予定立てて',
      context,
    );
    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange).toMatchObject({
      scope: { label: '日曜日まで', windowStartDate: '2026-07-17', windowEndDate: '2026-07-19' },
      planningEndDateTime: '2026-07-19T24:00:00',
    });
    expect(state.missing).toContain('planning_start_date');
    expect(state.missing).not.toContain('planning_duration');
    expect(state.missing).not.toContain('planning_period');
    expect(state.questions).toContain(
      '日曜日までの予定ですね。いつから始めますか？今すぐ、明日から、または別の開始時刻を指定できます。',
    );
  });

  it.each([
    ['今すぐ', '2026-07-17T16:00:00'],
    ['1時間後', '2026-07-17T17:00:00'],
    ['30分後', '2026-07-17T16:30:00'],
    ['今日20時から', '2026-07-17T20:00:00'],
    ['明日から', '2026-07-18T00:00:00'],
    ['明日の朝から', '2026-07-18T08:00:00'],
    ['7月18日14時から', '2026-07-18T14:00:00'],
  ])('resolves a flexible start answer: %s', (answer, expectedStart) => {
    const pending = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '日曜日までの予定立てて',
      context,
    );
    const state = applyWeeklyPlanningUserTurn(pending, answer, context);
    expect(state.range).toMatchObject({
      startDateTime: expectedStart,
      endDateTime: '2026-07-19T24:00:00',
      confidence: 'explicit',
    });
    expect(state.pendingPlanningRange).toBeUndefined();
    expect(state.missing).not.toContain('planning_start_date');
  });

  it('resolves an explicit start and Sunday end in one turn', () => {
    const state = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '今日20時から日曜日までの予定立てて',
      context,
    );
    expect(state.range).toMatchObject({
      startDateTime: '2026-07-17T20:00:00',
      endDateTime: '2026-07-19T24:00:00',
    });
  });

  it('does not discard the fixed end when the proposed start is after Sunday', () => {
    const pending = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '日曜日までの予定立てて',
      context,
    );
    const state = applyWeeklyPlanningUserTurn(pending, '月曜日から', context);
    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange?.planningEndDateTime).toBe('2026-07-19T24:00:00');
    expect(state.missing).toContain('planning_start_date');
  });

  it('still advances after the generic planning-period question', () => {
    const state = applyWeeklyPlanningUserTurn(waitingForPlanningPeriod(), '今週です', context);
    expect(state.range).toBeDefined();
    expect(state.missing).not.toContain('planning_period');
  });

  it.each([
    '先生が「日曜日まで」と言っていました',
    '「今すぐ」という例文',
    '1時間後から始める予定についての教材',
  ])('does not adopt quoted, reported, or example text: %s', (text) => {
    const state = applyWeeklyPlanningUserTurn(createInitialPlanningIntakeState(), text, context);
    expect(state.range).toBeUndefined();
    expect(state.pendingPlanningRange).toBeUndefined();
  });
});
''')

# 8. Record the corrected contract as a focused task, separate from Issue #21.
task_path = ROOT / 'docs/ai/tasks/20260717-weekly-planning-end-boundary-and-flexible-start.md'
task_path.write_text('''# 終了境界だけ指定された計画期間と任意開始日時を扱う

Status: implemented / verification pending
Priority: P0
Related Issue: #23
Related PR: #24

## 背景

実利用traceで「日曜日までの予定立てて」がdeadlineとしてだけ解釈され、planning rangeが未解決のまま「今週・来週・週末」を再質問した。さらに「今週」と答えても同じ質問が繰り返された。

## 契約

- 「日曜日まで」は直近の日曜日を終了境界として保持する。
- 開始地点が明示されていなければ、今週・来週ではなく開始日時だけを質問する。
- 「今すぐ」「N時間後」「N分後」「今日20時」「明日」「明日の朝」「月日＋時刻」などを開始地点として受理する。
- 開始と終了がそろった時だけcanonical `set_planning_range`へ昇格する。
- 終了後の開始候補は採用せず、固定済み終了境界を保持して再確認する。
- 引用、例文、第三者発話、教材文脈は自動採用しない。

## 非対象

- 漢数字絶対日付のtokenization（Issue #21）
- 週始まりprofile
- scheduler、preview、storage lifecycleの変更

## 検証

- focused regression
- weeklyPlanning全体
- build
- git diff --check
''', encoding='utf-8')
