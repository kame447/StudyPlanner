import type { ExamPrepScope, StudyProgress } from './weeklyPlanningIntakeTypes';
import { resolveFieldName } from './weeklyPlanningFieldParsing';
import { normalizeIntakeText, splitIntakeSegments, uniqueList } from './weeklyPlanningTextParsing';

export function parseProgressHint(text: string, fields: string[]): StudyProgress | undefined {
  for (const segment of splitIntakeSegments(text)) {
    if (
      hasIncompleteExpression(segment) ||
      hasConditionalCompletionExpression(segment) ||
      hasPlannedExpression(segment)
    ) {
      continue;
    }

    const match = segment.match(/([^\s、。]+?)(?:の)?\s*(20\d{2})\s*まで.*(?:終わ|済|完了|やった)/);

    if (!match) {
      continue;
    }

    return {
      field: resolveFieldName(match[1], fields),
      completionBoundaryYear: Number(match[2]),
      ambiguity: 'completion_direction',
      rawText: match[0],
    };
  }

  return undefined;
}

interface YearRangeExpression {
  startText: string;
  endText: string;
  sourceText: string;
  index: number;
}

interface CompletedYearDirectionResult {
  completedYears: number[];
  field: string;
  rawText: string;
}

function parseYearRangeExpressions(text: string): YearRangeExpression[] {
  const normalizedText = normalizeIntakeText(text);
  const rangeExpressions = Array.from(
    normalizedText.matchAll(/((?:20)?\d{2})\s*[〜~-]\s*((?:20)?\d{2})/g),
    (match) => ({
      startText: match[1],
      endText: match[2],
      sourceText: match[0],
      index: match.index ?? 0,
    }),
  );
  const fromToExpressions = Array.from(
    normalizedText.matchAll(/((?:20)?\d{2})\s*から\s*((?:20)?\d{2})\s*まで/g),
    (match) => ({
      startText: match[1],
      endText: match[2],
      sourceText: match[0],
      index: match.index ?? 0,
    }),
  );

  return [...rangeExpressions, ...fromToExpressions].sort(
    (left, right) => left.index - right.index,
  );
}

function resolveFieldScopeForYearRange(
  segment: string,
  rangeExpression: YearRangeExpression,
  fields: string[],
): string | undefined {
  const beforeRange = segment.slice(0, rangeExpression.index);
  const fieldMatch = beforeRange.match(/([^\s、。]+?)(?:の|は)?\s*$/);
  return resolveFieldName(fieldMatch?.[1], fields);
}

function normalizeYearToken(
  token: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
): number | undefined {
  if (/^20\d{2}$/.test(token)) {
    return Number(token);
  }

  if (!/^\d{2}$/.test(token) || !yearRange) {
    return undefined;
  }

  const yearSuffix = Number(token);
  const minYear = Math.min(yearRange.startYear, yearRange.endYear);
  const maxYear = Math.max(yearRange.startYear, yearRange.endYear);
  const baseCentury = Math.floor(minYear / 100) * 100;
  const candidates = uniqueList([
    baseCentury + yearSuffix,
    baseCentury + 100 + yearSuffix,
    baseCentury - 100 + yearSuffix,
  ]);

  return candidates.find((candidate) => candidate >= minYear && candidate <= maxYear);
}

function expandYearRange(startYear: number, endYear: number): number[] {
  const step = startYear >= endYear ? -1 : 1;
  const years: number[] = [];

  for (let year = startYear; step > 0 ? year <= endYear : year >= endYear; year += step) {
    years.push(year);
  }

  return years;
}

function hasIncompleteExpression(text: string): boolean {
  return /残ってる|残る|残り|まだ|未完了|未着手|未了|終わって?ない|完了していない|完了してない|やってない|済んでない/.test(
    normalizeIntakeText(text),
  );
}

function hasConditionalCompletionExpression(text: string): boolean {
  return /終わったら|終われば|完了したら|済んだら|やったら/.test(normalizeIntakeText(text));
}

function hasPlannedExpression(text: string): boolean {
  return /やる予定|やりたい|やるつもり|予定/.test(normalizeIntakeText(text));
}

function hasCompletionExpression(text: string): boolean {
  const normalizedText = normalizeIntakeText(text);

  if (
    hasIncompleteExpression(normalizedText) ||
    hasConditionalCompletionExpression(normalizedText) ||
    hasPlannedExpression(normalizedText)
  ) {
    return false;
  }

  return /終わった|終わってる|済んだ|済み|済ませた|完了|やった/.test(normalizedText);
}

export function parseCompletedYearDirection(
  text: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
  fields: string[],
): CompletedYearDirectionResult | undefined {
  for (const segment of splitIntakeSegments(text)) {
    if (!hasCompletionExpression(segment)) {
      continue;
    }

    const rangeExpressions = parseYearRangeExpressions(segment);
    const rangeExpression = rangeExpressions[rangeExpressions.length - 1];

    if (!rangeExpression) {
      continue;
    }

    const field = resolveFieldScopeForYearRange(segment, rangeExpression, fields);

    if (!field) {
      continue;
    }

    const startYear = normalizeYearToken(rangeExpression.startText, yearRange);
    const endYear = normalizeYearToken(rangeExpression.endText, yearRange);

    if (!startYear || !endYear) {
      continue;
    }

    return {
      completedYears: expandYearRange(startYear, endYear),
      field,
      rawText: segment,
    };
  }

  return undefined;
}
