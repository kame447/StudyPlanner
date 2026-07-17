from pathlib import Path

ROOT = Path('.')
SCOPE_PATH = ROOT / 'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts'
VALIDATOR_PATH = ROOT / 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts'
PIPELINE_PATH = ROOT / 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts'
ABSOLUTE_DATE_PATH = ROOT / 'src/features/weeklyPlanning/intake/weeklyPlanningAbsoluteDate.ts'
TEST_PATH = ROOT / 'src/features/weeklyPlanning/intake/weeklyPlanningKanjiAbsoluteDateGuard.test.ts'
VALIDATION_WORKFLOW_PATH = ROOT / '.github/workflows/pr-kanji-absolute-date-validation.yml'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old, new, 1)


ABSOLUTE_DATE_PATH.write_text("""import { isIsoCalendarDate } from './weeklyPlanningDateValidation';
import { normalizeIntakeText } from './weeklyPlanningTextParsing';

const KANJI_CALENDAR_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CALENDAR_NUMBER_PATTERN = '[0-9]{1,2}|[一二三四五六七八九十]{1,3}';
const ABSOLUTE_MONTH_DAY_PATTERN_SOURCE =
  `(${CALENDAR_NUMBER_PATTERN})\\\\s*月\\\\s*(${CALENDAR_NUMBER_PATTERN})\\\\s*日`;

export interface AbsoluteMonthDayToken {
  rawText: string;
  month: number | undefined;
  day: number | undefined;
}

function parseKanjiCalendarNumber(token: string): number | undefined {
  if (/^\\d{1,2}$/.test(token)) return Number(token);
  if (token === '十') return 10;

  const match = token.match(/^([一二三])?十([一二三四五六七八九])?$/);
  if (match) {
    const tens = match[1] ? KANJI_CALENDAR_DIGITS[match[1]] : 1;
    const ones = match[2] ? KANJI_CALENDAR_DIGITS[match[2]] : 0;
    return tens * 10 + ones;
  }

  return KANJI_CALENDAR_DIGITS[token];
}

function absoluteMonthDayPattern(flags?: string): RegExp {
  return new RegExp(ABSOLUTE_MONTH_DAY_PATTERN_SOURCE, flags);
}

export function findAbsoluteMonthDayToken(text: string): AbsoluteMonthDayToken | undefined {
  const match = normalizeIntakeText(text).match(absoluteMonthDayPattern());
  if (!match) return undefined;

  return {
    rawText: match[0],
    month: parseKanjiCalendarNumber(match[1]),
    day: parseKanjiCalendarNumber(match[2]),
  };
}

export function hasAbsoluteMonthDayToken(text: string): boolean {
  return Boolean(findAbsoluteMonthDayToken(text));
}

export function stripAbsoluteMonthDayTokens(text: string): string {
  return normalizeIntakeText(text).replace(absoluteMonthDayPattern('g'), '');
}

export function resolveAbsoluteMonthDayDate(
  text: string,
  selectedDate: string,
): string | undefined {
  const token = findAbsoluteMonthDayToken(text);
  if (!token || token.month === undefined || token.day === undefined) return undefined;
  if (token.month < 1 || token.month > 12 || token.day < 1 || token.day > 31) {
    return undefined;
  }
  if (!isIsoCalendarDate(selectedDate)) return undefined;

  const selectedYear = Number(selectedDate.slice(0, 4));
  const dateForYear = (year: number) =>
    `${year}-${String(token.month).padStart(2, '0')}-${String(token.day).padStart(2, '0')}`;
  const thisYear = dateForYear(selectedYear);
  const candidate = thisYear < selectedDate
    ? dateForYear(selectedYear + 1)
    : thisYear;

  return isIsoCalendarDate(candidate) ? candidate : undefined;
}

export function isPlanningRangeConsistentWithAbsoluteDateSource(params: {
  sourceText: string;
  selectedDate: string;
  startDateTime?: string;
}): boolean {
  if (!hasAbsoluteMonthDayToken(params.sourceText)) return true;

  const absoluteDate = resolveAbsoluteMonthDayDate(params.sourceText, params.selectedDate);
  return Boolean(
    absoluteDate
    && params.startDateTime
    && params.startDateTime.slice(0, 10) === absoluteDate,
  );
}
""", encoding='utf-8')

scope = SCOPE_PATH.read_text(encoding='utf-8')
scope = replace_once(
    scope,
    """} from './weeklyPlanningTextParsing';
""",
    """} from './weeklyPlanningTextParsing';
import {
  hasAbsoluteMonthDayToken,
  resolveAbsoluteMonthDayDate,
  stripAbsoluteMonthDayTokens,
} from './weeklyPlanningAbsoluteDate';
""",
    'scope import',
)
scope = replace_once(
    scope,
    """function isBareStartDateAnswer(text: string): boolean {
  return /^\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日(?:\\s*から)?(?:\\s*です)?\\s*$/.test(
    normalizeIntakeText(text),
  );
}
""",
    """function isBareStartDateAnswer(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return hasAbsoluteMonthDayToken(normalizedText)
    && /^\\s*(?:から)?(?:\\s*です)?\\s*$/.test(
      stripAbsoluteMonthDayTokens(normalizedText),
    );
}
""",
    'bare start answer',
)
scope = replace_once(
    scope,
    """function isCombinedStartAndDurationAnswer(text: string): boolean {
  return /^\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日(?:\\s*から)?\\s*(?:(?:一|1)\\s*週間|7\\s*日間?)(?:\\s*です)?\\s*$/.test(
    normalizeIntakeText(text),
  );
}
""",
    """function isCombinedStartAndDurationAnswer(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);
  return hasAbsoluteMonthDayToken(normalizedText)
    && /^\\s*(?:から)?\\s*(?:(?:一|1)\\s*週間|7\\s*日間?)(?:\\s*です)?\\s*$/.test(
      stripAbsoluteMonthDayTokens(normalizedText),
    );
}
""",
    'combined start and duration answer',
)
scope = replace_once(
    scope,
    """      && /(?:計画|予定).*(?:開始|始め).*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日/.test(
        normalizeIntakeText(text),
      )
""",
    """      && hasAbsoluteMonthDayToken(text)
      && /(?:計画|予定).*(?:開始|始め)|(?:開始|始め).*(?:計画|予定)/.test(
        normalizeIntakeText(text),
      )
""",
    'long form start answer',
)
scope = replace_once(
    scope,
    """function parseExplicitDate(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string | undefined {
  const match = normalizeIntakeText(text).match(/(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日(?:\\s*から)?/);
  if (!match) return undefined;

  const selectedYear = Number(context.selectedDate.slice(0, 4));
  const month = Number(match[1]);
  const day = Number(match[2]);
  const dateForYear = (year: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const thisYear = dateForYear(selectedYear);
  const candidate = thisYear < context.selectedDate
    ? dateForYear(selectedYear + 1)
    : thisYear;
  return isIsoCalendarDate(candidate) ? candidate : undefined;
}
""",
    """function parseExplicitDate(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string | undefined {
  return resolveAbsoluteMonthDayDate(text, context.selectedDate);
}
""",
    'explicit date parser',
)
scope = replace_once(
    scope,
    """function parseWeekdayStart(text: string): number | undefined {
  const normalizedText = normalizeIntakeText(text);
  const withoutExplicitMonthDays = normalizedText.replace(
    /\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日/g,
    '',
  );
  const match = withoutExplicitMonthDays.match(/([月火水木金土日])(?:曜(?:日)?)?\\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}
""",
    """function parseWeekdayStart(text: string): number | undefined {
  const withoutExplicitMonthDays = stripAbsoluteMonthDayTokens(text);
  const match = withoutExplicitMonthDays.match(/([月火水木金土日])(?:曜(?:日)?)?\\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}
""",
    'weekday parser',
)
scope = replace_once(
    scope,
    """  const dayMatch = normalizedText.match(/^(?:明後日|明日|今日)/)
    ?? normalizedText.match(/(?:^|\\s)(今日|明日|明後日)/);
  const weekdayMatch = normalizedText.match(
    /([月火水木金土日])(?:曜(?:日)?)?(?:の(朝|昼|夜))?\\s*から/,
  );
  const explicitDate = parseExplicitDate(normalizedText, context);
  let date: string | undefined;
""",
    """  const dayMatch = normalizedText.match(/^(?:明後日|明日|今日)/)
    ?? normalizedText.match(/(?:^|\\s)(今日|明日|明後日)/);
  const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
  const weekdayMatch = containsAbsoluteMonthDay
    ? undefined
    : normalizedText.match(
      /([月火水木金土日])(?:曜(?:日)?)?(?:の(朝|昼|夜))?\\s*から/,
    );
  const explicitDate = parseExplicitDate(normalizedText, context);
  if (containsAbsoluteMonthDay && !explicitDate) return undefined;
  let date: string | undefined;
""",
    'planning start datetime absolute guard',
)
scope = replace_once(
    scope,
    """  if (currentPending) {
    const explicitDate = acceptsStartDateAnswer(text, options?.expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    if (explicitDate) {
""",
    """  if (currentPending) {
    const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
    const explicitDate = acceptsStartDateAnswer(text, options?.expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    if (containsAbsoluteMonthDay && !explicitDate) return undefined;
    if (explicitDate) {
""",
    'pending absolute guard',
)
scope = replace_once(
    scope,
    """    const durationDays = acceptsDurationAnswer(text, expectedSlot)
      && hasOneWeekDuration(normalizedText)
      ? 7
      : pending.durationDays;
    const explicitDate = acceptsStartDateAnswer(text, expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    const weekdayIndex = acceptsStartDateAnswer(text, expectedSlot)
      ? parseWeekdayStart(normalizedText)
      : undefined;
""",
    """    const durationDays = acceptsDurationAnswer(text, expectedSlot)
      && hasOneWeekDuration(normalizedText)
      ? 7
      : pending.durationDays;
    const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
    const explicitDate = acceptsStartDateAnswer(text, expectedSlot)
      ? parseExplicitDate(normalizedText, context)
      : undefined;
    if (containsAbsoluteMonthDay && !explicitDate) return undefined;
    const weekdayIndex = acceptsStartDateAnswer(text, expectedSlot)
      && !containsAbsoluteMonthDay
      ? parseWeekdayStart(normalizedText)
      : undefined;
""",
    'resolved pending absolute guard',
)
scope = replace_once(
    scope,
    """  const explicitDate = parseExplicitDate(normalizedText, context);
  if (explicitDate) {
    return rangeFromStartDate({ startDate: explicitDate, durationDays, sourceText: text });
  }

  if (/来週/.test(normalizedText)) {
""",
    """  const containsAbsoluteMonthDay = hasAbsoluteMonthDayToken(normalizedText);
  const explicitDate = parseExplicitDate(normalizedText, context);
  if (explicitDate) {
    return rangeFromStartDate({ startDate: explicitDate, durationDays, sourceText: text });
  }
  if (containsAbsoluteMonthDay) return undefined;

  if (/来週/.test(normalizedText)) {
""",
    'nonpending absolute fallback guard',
)
SCOPE_PATH.write_text(scope, encoding='utf-8')

validator = VALIDATOR_PATH.read_text(encoding='utf-8')
validator = replace_once(
    validator,
    """import { normalizeExamScopeEnrichment } from './weeklyPlanningExamScopeEnrichment';
""",
    """import { normalizeExamScopeEnrichment } from './weeklyPlanningExamScopeEnrichment';
import { isPlanningRangeConsistentWithAbsoluteDateSource } from './weeklyPlanningAbsoluteDate';
import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
""",
    'candidate validator imports',
)
validator = replace_once(
    validator,
    """export function validateInterpretedCandidates(
  candidates: InterpretedCommandCandidate[],
  summary: InterpreterStateSummary,
): CandidateValidationResult {
""",
    """export function validateInterpretedCandidates(
  candidates: InterpretedCommandCandidate[],
  summary: InterpreterStateSummary,
  context?: WeeklyPlanningIntakeContext,
): CandidateValidationResult {
""",
    'candidate validator signature',
)
validator = replace_once(
    validator,
    """    if (valueError) {
      addRejected(result, effectiveCandidate, valueError);
      return;
    }

    if (command.type === 'use_constraint_source') {
""",
    """    if (valueError) {
      addRejected(result, effectiveCandidate, valueError);
      return;
    }

    if (
      command.type === 'set_planning_range'
      && context
      && !isPlanningRangeConsistentWithAbsoluteDateSource({
        sourceText: command.sourceSegment ?? command.sourceText,
        selectedDate: context.selectedDate,
        startDateTime: command.range.startDateTime,
      })
    ) {
      addRejected(result, effectiveCandidate, 'planning-range-absolute-date-mismatch');
      return;
    }

    if (command.type === 'use_constraint_source') {
""",
    'candidate absolute date validation',
)
VALIDATOR_PATH.write_text(validator, encoding='utf-8')

pipeline = PIPELINE_PATH.read_text(encoding='utf-8')
pipeline = replace_once(
    pipeline,
    """  const interpreterDiagnostics = validateInterpretedCandidates(resolvedCandidates, stateSummary);
""",
    """  const interpreterDiagnostics = validateInterpretedCandidates(
    resolvedCandidates,
    stateSummary,
    context,
  );
""",
    'pipeline validator context',
)
PIPELINE_PATH.write_text(pipeline, encoding='utf-8')

TEST_PATH.write_text("""import { describe, expect, it } from 'vitest';
import { validateInterpretedCandidates } from './weeklyPlanningCandidateValidator';
import type { InterpretedCommandCandidate, InterpreterStateSummary, WeeklyPlanningIntakeInterpreter } from './weeklyPlanningInterpreterTypes';
import type { PendingPlanningRangeClarification, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import {
  applyWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from './weeklyPlanningIntakeReducer';
import {
  nextWeekScope,
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from '../pipeline/weeklyPlanningIntakePipeline';

function context(selectedDate: string): WeeklyPlanningIntakeContext {
  return {
    selectedDate,
    currentDateTime: `${selectedDate}T09:00:00`,
  };
}

function pendingNextWeek(selectedDate: string): PendingPlanningRangeClarification {
  return {
    scope: nextWeekScope(context(selectedDate)),
    durationDays: 7,
    sourceText: '来週の予定を立てたい',
  };
}

function summaryForPending(selectedDate: string): InterpreterStateSummary {
  const pending = pendingNextWeek(selectedDate);
  return {
    knownFields: [],
    confirmedSlots: [],
    pendingPlanningRange: {
      kind: pending.scope.kind,
      label: pending.scope.label,
      windowStartDate: pending.scope.windowStartDate,
      windowEndDate: pending.scope.windowEndDate,
      durationDays: pending.durationDays,
    },
  };
}

function rangeCandidate(params: {
  sourceText: string;
  startDateTime: string;
  endDateTime: string;
}): InterpretedCommandCandidate {
  return {
    origin: 'ai_interpreter',
    needsConfirmation: false,
    command: {
      type: 'set_planning_range',
      confidence: 'high',
      sourceText: params.sourceText,
      range: {
        startDateTime: params.startDateTime,
        endDateTime: params.endDateTime,
        sourceText: params.sourceText,
        confidence: 'explicit',
      },
    },
  };
}

describe('漢数字を含む絶対日付のguard', () => {
  it.each([
    '8月1日から一週間',
    '8月一日から一週間',
    '八月1日から一週間',
    '八月一日から一週間',
  ])('%sを同じ絶対日付として解決する', (text) => {
    const command = parseSetPlanningRangeCommand(text, context('2026-07-26'));
    expect(command?.range.startDateTime).toBe('2026-08-01T00:00:00');
    expect(command?.range.endDateTime).toBe('2026-08-07T24:00:00');
  });

  it.each([
    '8月1日から',
    '8月一日から',
    '八月1日から',
    '八月一日から',
  ])('pending期間の開始日として%sを受理する', (text) => {
    const command = parseSetPlanningRangeCommand(
      text,
      context('2026-07-26'),
      pendingNextWeek('2026-07-26'),
      'planning_start_date',
    );
    expect(command?.range.startDateTime).toBe('2026-08-01T00:00:00');
    expect(command?.range.startDateTime).not.toBe('2026-08-02T00:00:00');
  });

  it('pending来週の範囲外にある漢数字日付を日曜日へfallbackしない', () => {
    const intakeContext = context('2026-06-26');
    const pending = pendingNextWeek('2026-06-26');

    expect(parseSetPlanningRangeCommand(
      '八月一日から一週間',
      intakeContext,
      pending,
      'planning_start_date',
    )).toBeUndefined();
    expect(parseSetPendingPlanningRangeCommand(
      '八月一日から一週間',
      intakeContext,
      { pending, expectedSlot: 'planning_start_date' },
    )).toBeUndefined();
  });

  it.each(['日曜日から一週間', '日曜から一週間', '来週の日曜日から一週間'])(
    '%sの曜日解決を維持する',
    (text) => {
      const command = parseSetPlanningRangeCommand(
        text,
        context('2026-07-26'),
        pendingNextWeek('2026-07-26'),
        'planning_start_date',
      );
      expect(command?.range.startDateTime).toBe('2026-08-02T00:00:00');
    },
  );

  it.each(['一日だけ勉強する', '一週間で進める'])(
    '%sを絶対日付または日曜日として扱わない',
    (text) => {
      expect(parseSetPlanningRangeCommand(
        text,
        context('2026-07-26'),
        pendingNextWeek('2026-07-26'),
        'planning_start_date',
      )).toBeUndefined();
    },
  );

  it.each(['十三月一日から一週間', '二月三十一日から一週間'])(
    '%sの解決失敗時に曜日へfallbackしない',
    (text) => {
      expect(parseSetPlanningRangeCommand(
        text,
        context('2026-01-01'),
        pendingNextWeek('2026-01-01'),
        'planning_start_date',
      )).toBeUndefined();
    },
  );

  it('AI candidateの開始日がsourceTextの絶対日付と異なる場合は拒否する', () => {
    const intakeContext = context('2026-07-26');
    const candidate = rangeCandidate({
      sourceText: '八月一日から一週間',
      startDateTime: '2026-08-02T00:00:00',
      endDateTime: '2026-08-08T24:00:00',
    });
    const validation = validateInterpretedCandidates(
      [candidate],
      summaryForPending('2026-07-26'),
      intakeContext,
    );

    expect(validation.accepted).toHaveLength(0);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'planning-range-absolute-date-mismatch' }),
    ]);
  });

  it('AI candidateの開始日がsourceTextの絶対日付と一致する場合は受理する', () => {
    const intakeContext = context('2026-07-26');
    const candidate = rangeCandidate({
      sourceText: '八月一日から一週間',
      startDateTime: '2026-08-01T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
    });
    const validation = validateInterpretedCandidates(
      [candidate],
      summaryForPending('2026-07-26'),
      intakeContext,
    );

    expect(validation.rejected).toHaveLength(0);
    expect(validation.accepted).toHaveLength(1);
  });

  it('pipelineで範囲外の漢数字日付をAI候補の日曜日へ置換しない', async () => {
    const selectedDate = '2026-06-26';
    const intakeContext = context(selectedDate);
    const previousState = applyWeeklyPlanningUserTurn(
      createInitialPlanningIntakeState(),
      '来週の予定を立てたい',
      intakeContext,
    );
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn() {
        return {
          candidates: [rangeCandidate({
            sourceText: '八月一日から一週間',
            startDateTime: '2026-07-05T00:00:00',
            endDateTime: '2026-07-11T24:00:00',
          })],
          parseRejections: [],
        };
      },
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState,
      userText: '八月一日から一週間',
      planningStartDate: selectedDate,
      planningDayCount: 7,
      currentDateTime: `${selectedDate}T09:00:00`,
      interpreter,
    });

    expect(output.state.range).toBeUndefined();
    expect(output.state.pendingPlanningRange?.scope).toMatchObject({
      windowStartDate: '2026-06-29',
      windowEndDate: '2026-07-05',
    });
    expect(output.interpreterDiagnostics?.rejected).toEqual([
      expect.objectContaining({ reason: 'planning-range-absolute-date-mismatch' }),
    ]);
  });
});
""", encoding='utf-8')

VALIDATION_WORKFLOW_PATH.write_text("""name: Kanji absolute date PR validation

on:
  pull_request:
    branches:
      - main
    types:
      - opened
      - synchronize
      - reopened
      - ready_for_review

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22.23.0'
          cache: npm
      - run: npm ci
      - name: Diff check
        run: git diff --check origin/main...HEAD
      - name: Focused regression
        run: npm run test:run -- src/features/weeklyPlanning/intake/weeklyPlanningKanjiAbsoluteDateGuard.test.ts
      - name: Weekly planning suite
        run: npm run test:run -- src/features/weeklyPlanning
      - name: Full test suite
        run: npm run test:run
      - name: Production build
        run: npm run build
""", encoding='utf-8')
