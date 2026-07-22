import type { SetExamScopeCommand } from './weeklyPlanningCommandTypes';
import type { ExamPrepScope } from './weeklyPlanningIntakeTypes';

function uniqueList<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export interface ExamScopeEnrichmentResult {
  command?: SetExamScopeCommand;
  error?: 'confirmed-slot-overwrite';
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  return leftSet.size === rightSet.size && Array.from(leftSet).every((value) => rightSet.has(value));
}

function sameYearRange(
  left: { startYear: number; endYear: number; sourceText?: string } | undefined,
  right: { startYear: number; endYear: number; sourceText?: string } | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.startYear === right.startYear && left.endYear === right.endYear;
}

function conflicts<T>(existing: T | undefined, incoming: T | undefined): boolean {
  return existing !== undefined && incoming !== undefined && existing !== incoming;
}

export function normalizeExamScopeEnrichment(
  command: SetExamScopeCommand,
  existing: (Omit<Partial<ExamPrepScope>, 'fields' | 'yearRange'> & {
    fields: string[];
    rawText?: string[];
    yearRange?: { startYear: number; endYear: number; sourceText?: string };
  }) | undefined,
): ExamScopeEnrichmentResult {
  if (!existing) return { command };
  const incoming = command.scope;

  if (existing.fields.length > 0 && incoming.fields.length > 0
    && !sameStringSet(existing.fields, incoming.fields)) {
    return { error: 'confirmed-slot-overwrite' };
  }
  if (existing.yearRange && incoming.yearRange && !sameYearRange(existing.yearRange, incoming.yearRange)) {
    return { error: 'confirmed-slot-overwrite' };
  }
  if (
    conflicts(existing.examType, incoming.examType)
    || conflicts(existing.totalFields, incoming.totalFields)
    || conflicts(existing.totalYears, incoming.totalYears)
    || conflicts(existing.strategyHint, incoming.strategyHint)
    || conflicts(existing.unitModel, incoming.unitModel)
    || conflicts(existing.unitCountHint, incoming.unitCountHint)
  ) {
    return { error: 'confirmed-slot-overwrite' };
  }

  const examType = existing.examType ?? incoming.examType;
  const totalFields = existing.totalFields ?? incoming.totalFields;
  const totalYears = existing.totalYears ?? incoming.totalYears;
  const strategyHint = existing.strategyHint ?? incoming.strategyHint;
  const unitModel = existing.unitModel ?? incoming.unitModel;
  const unitCountHint = existing.unitCountHint ?? incoming.unitCountHint;
  const yearRange = existing.yearRange
    ? {
        ...existing.yearRange,
        sourceText: existing.yearRange.sourceText ?? incoming.yearRange?.sourceText ?? '',
      }
    : incoming.yearRange;

  return {
    command: {
      ...command,
      scope: {
        ...(examType !== undefined ? { examType } : {}),
        fields: existing.fields.length > 0 ? [...existing.fields] : [...incoming.fields],
        ...(totalFields !== undefined ? { totalFields } : {}),
        ...(totalYears !== undefined ? { totalYears } : {}),
        ...(yearRange ? { yearRange } : {}),
        ...(strategyHint !== undefined ? { strategyHint } : {}),
        ...(unitModel !== undefined ? { unitModel } : {}),
        ...(unitCountHint !== undefined ? { unitCountHint } : {}),
        rawText: uniqueList([...(existing.rawText ?? []), ...incoming.rawText]),
      },
    },
  };
}
