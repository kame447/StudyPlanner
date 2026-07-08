import type { MarkCompletedUnitsCommand, MarkCompletionTargetCommand, NoteProgressBoundaryCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope, StudyProgress } from './weeklyPlanningIntakeTypes';
import { resolveFieldName } from './weeklyPlanningFieldParsing';
import { normalizeIntakeText, parseSmallInteger, splitIntakeSegments, uniqueList } from './weeklyPlanningTextParsing';

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

export function parseNoteProgressBoundaryCommand(
  text: string,
  fields: string[],
): NoteProgressBoundaryCommand | undefined {
  const progressHint = parseProgressHint(text, fields);
  const boundaryYear = progressHint?.completionBoundaryYear;

  return progressHint && boundaryYear !== undefined
    ? {
        type: 'note_progress_boundary',
        field: progressHint.field,
        boundaryYear,
        ambiguity: 'completion_direction',
        sourceText: text,
        sourceSegment: progressHint.rawText,
        confidence: 'medium',
      }
    : undefined;
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

interface CompletedSingleYearRevisionResult {
  completedYear: number;
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


function resolveFieldScopeBeforeYear(segment: string, yearIndex: number, fields: string[]): string | undefined {
  const beforeYear = segment
    .slice(0, yearIndex)
    .replace(/\u3084\u3063\u3071\u308a|\u3084\u306f\u308a|\u3042\u3068|\u8ffd\u52a0\u3067/g, ' ');
  const tokens = beforeYear
    .split(/[\s\u3001\u3002\u306e\u306f\u3082]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const field = resolveFieldName(tokens[index], fields);

    if (field && fields.includes(field)) {
      return field;
    }
  }

  return fields.find((field) => {
    if (beforeYear.includes(field)) {
      return true;
    }

    return field
      .split(/[\s\u30fb/]+/)
      .filter((fieldToken) => fieldToken.length >= 2)
      .some((fieldToken) => beforeYear.includes(fieldToken));
  });
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

  return /\u7d42\u308f\u3063\u305f|\u7d42\u308f\u3063\u3066\u308b|\u7d42\u308f\u3063\u3066\u305f|\u6e08\u3093\u3060|\u6e08\u307f|\u6e08\u307e\u305b\u305f|\u5b8c\u4e86|\u3084\u3063\u305f/.test(normalizedText);
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


export function parseCompletedSingleYearRevision(
  text: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
  fields: string[],
): CompletedSingleYearRevisionResult | undefined {
  for (const segment of splitIntakeSegments(text)) {
    if (!hasCompletionExpression(segment)) {
      continue;
    }

    if (parseYearRangeExpressions(segment).length > 0) {
      continue;
    }

    const normalizedSegment = normalizeIntakeText(segment);
    const match = normalizedSegment.match(/((?:20)?\d{2})\s*(?:\u3082|\u306f)?\s*(?:\u7d42\u308f\u3063\u305f|\u7d42\u308f\u3063\u3066\u308b|\u7d42\u308f\u3063\u3066\u305f|\u6e08\u3093\u3060|\u6e08\u307f|\u6e08\u307e\u305b\u305f|\u5b8c\u4e86|\u3084\u3063\u305f)/);

    if (!match) {
      continue;
    }

    const field = resolveFieldScopeBeforeYear(
      normalizedSegment,
      match.index ?? 0,
      fields,
    );

    if (!field) {
      continue;
    }

    const completedYear = normalizeYearToken(match[1], yearRange);

    if (!completedYear || !yearRange) {
      continue;
    }

    const minYear = Math.min(yearRange.startYear, yearRange.endYear);
    const maxYear = Math.max(yearRange.startYear, yearRange.endYear);

    if (completedYear < minYear || completedYear > maxYear) {
      continue;
    }

    return {
      completedYear,
      field,
      rawText: segment,
    };
  }

  return undefined;
}

function resolveFieldScopesFromText(rawText: string, fields: string[]): string[] {
  const normalizedText = normalizeIntakeText(rawText)
    .replace(/(?:は|を|の|系)$/g, '')
    .trim();
  const tokens = normalizedText
    .split(/と|、|,|，|・|\/|＆|&|\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const resolved = tokens
    .map((token) => resolveFieldName(token, fields))
    .filter((field): field is string => Boolean(field));

  const directMatches = fields.filter((field) => {
    if (normalizedText.includes(field)) {
      return true;
    }

    return field
      .split(/[\s・/]+/)
      .filter((fieldToken) => fieldToken.length >= 2)
      .some((fieldToken) => normalizedText.includes(fieldToken));
  });

  return uniqueList([...resolved, ...directMatches]);
}

function createCompletionTargetCommands(params: {
  text: string;
  segment: string;
  fieldText?: string;
  target: MarkCompletionTargetCommand['target'];
  fields: string[];
  confidence: MarkCompletionTargetCommand['confidence'];
}): MarkCompletionTargetCommand[] {
  const resolvedFields = resolveFieldScopesFromText(params.fieldText ?? '', params.fields);

  if (resolvedFields.length === 0) {
    return [{
      type: 'mark_completion_target',
      target: params.target,
      sourceText: params.text,
      sourceSegment: params.segment,
      confidence: params.confidence,
    }];
  }

  return resolvedFields.map((field) => ({
    type: 'mark_completion_target',
    field,
    target: params.target,
    sourceText: params.text,
    sourceSegment: params.segment,
    confidence: params.confidence,
  }));
}

function hasCompletionTargetExpression(text: string): boolean {
  return /やりたい|やるつもり|やる予定|進めたい|終わらせたい|終えたい|片付けたい|全部|全て|すべて|できるところまで|出来るところまで|いけるところまで|可能なところまで/.test(
    normalizeIntakeText(text),
  );
}

export function parseMarkCompletionTargetCommands(
  text: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
  fields: string[],
): MarkCompletionTargetCommand[] {
  const commands: MarkCompletionTargetCommand[] = [];

  for (const segment of splitIntakeSegments(text)) {
    const normalizedSegment = normalizeIntakeText(segment);

    if (/できるところまで|出来るところまで|いけるところまで|可能なところまで/.test(normalizedSegment)) {
      commands.push(...createCompletionTargetCommands({
        text,
        segment,
        fieldText: normalizedSegment.replace(/(?:できるところまで|出来るところまで|いけるところまで|可能なところまで).*/, ''),
        target: { kind: 'up_to_reachable', rawText: segment },
        fields,
        confidence: 'medium',
      }));
      continue;
    }

    const latestYearsMatch = normalizedSegment.match(/(.+?)(?:は|を|の)?\s*([0-9一二三四五六七八九十]+)\s*年分(?:は)?(?:.*(?:やりたい|やるつもり|やる予定|進めたい|終わらせたい|終えたい|片付けたい))?/);
    if (latestYearsMatch && hasCompletionTargetExpression(normalizedSegment)) {
      const count = parseSmallInteger(latestYearsMatch[2]);
      if (count && count > 0) {
        commands.push(...createCompletionTargetCommands({
          text,
          segment,
          fieldText: latestYearsMatch[1],
          target: { kind: 'latest_n_years', count, rawText: segment },
          fields,
          confidence: 'high',
        }));
        continue;
      }
    }

    const allMatch = normalizedSegment.match(/(?:(.+?)(?:は|を|の)?\s*)?(?:全部|全て|すべて)(?:かな|.*(?:やりたい|やるつもり|やる予定|進めたい|終わらせたい|終えたい|片付けたい))?/);
    if (allMatch) {
      commands.push(...createCompletionTargetCommands({
        text,
        segment,
        fieldText: allMatch[1] ?? '',
        target: { kind: 'all', rawText: segment },
        fields,
        confidence: 'high',
      }));
      continue;
    }

    if (!/やりたい|進めたい|終わらせたい|終えたい|片付けたい/.test(normalizedSegment)) {
      continue;
    }

    const rangeExpressions = parseYearRangeExpressions(normalizedSegment);
    rangeExpressions.forEach((rangeExpression) => {
      const startYear = normalizeYearToken(rangeExpression.startText, yearRange);
      const endYear = normalizeYearToken(rangeExpression.endText, yearRange);

      if (!startYear || !endYear) {
        return;
      }

      commands.push(...createCompletionTargetCommands({
        text,
        segment,
        fieldText: normalizedSegment.slice(0, rangeExpression.index),
        target: { kind: 'year_range', startYear, endYear, rawText: segment },
        fields,
        confidence: 'high',
      }));
    });
  }

  return commands;
}

export function parseMarkCompletedUnitsCommand(
  text: string,
  yearRange: ExamPrepScope['yearRange'] | undefined,
  fields: string[],
): MarkCompletedUnitsCommand | undefined {
  const completedYearDirection = parseCompletedYearDirection(text, yearRange, fields);

  if (completedYearDirection) {
    return {
      type: 'mark_completed_units',
      field: completedYearDirection.field,
      completedYears: completedYearDirection.completedYears,
      mergeMode: 'replace',
      sourceText: text,
      sourceSegment: completedYearDirection.rawText,
      confidence: 'high',
    };
  }

  const completedSingleYearRevision = parseCompletedSingleYearRevision(text, yearRange, fields);

  return completedSingleYearRevision
    ? {
        type: 'mark_completed_units',
        field: completedSingleYearRevision.field,
        completedYears: [completedSingleYearRevision.completedYear],
        mergeMode: 'append',
        sourceText: text,
        sourceSegment: completedSingleYearRevision.rawText,
        confidence: 'high',
      }
    : undefined;
}