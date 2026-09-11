import type {
  TimetablePeriod,
  TimetableTerm,
  TimetableTermKind,
} from '../types/domain';
import { resolveActiveTimetableTerm } from './timetableTerm';

function getTimetableTermKindLabel(kind: TimetableTermKind): string {
  switch (kind) {
    case 'firstHalf':
      return '前期';
    case 'secondHalf':
      return '後期';
    case 'term1':
      return '1学期';
    case 'term2':
      return '2学期';
    case 'term3':
      return '3学期';
    case 'term4':
      return '4学期';
    case 'fullYear':
      return '通年';
    case 'custom':
      return 'カスタム';
    default:
      return '通年';
  }
}

export function createTimetableTermLabel(
  year: number,
  kind: TimetableTermKind,
  fallbackLabel?: string,
): string {
  const normalizedYear = Number.isFinite(year) ? Math.round(year) : new Date().getFullYear();
  const customLabel = fallbackLabel?.trim();

  if (kind === 'custom' && customLabel) {
    return customLabel;
  }

  return `${normalizedYear}年 ${getTimetableTermKindLabel(kind)}`;
}

function getTimetableTermKindKey(kind: TimetableTermKind): string {
  switch (kind) {
    case 'firstHalf':
      return 'first';
    case 'secondHalf':
      return 'second';
    case 'term1':
      return 'term1';
    case 'term2':
      return 'term2';
    case 'term3':
      return 'term3';
    case 'term4':
      return 'term4';
    case 'custom':
      return 'custom';
    case 'fullYear':
    default:
      return 'full-year';
  }
}

export function createTimetableTermId(year: number, kind: TimetableTermKind): string {
  const normalizedYear = Number.isFinite(year)
    ? Math.round(year)
    : new Date().getFullYear();

  return `${normalizedYear}-${getTimetableTermKindKey(kind)}`;
}

export function normalizeTimetableDate(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? normalized
    : null;
}

function createDefaultTimetableTerm(userId: string): TimetableTerm {
  const now = new Date().toISOString();
  const year = new Date().getFullYear();

  return {
    id: createTimetableTermId(year, 'fullYear'),
    userId,
    year,
    kind: 'fullYear',
    label: `${year}年 通年`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

function pickLatestTimetableTerm(terms: TimetableTerm[]): TimetableTerm {
  return terms
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function sortTimetableTerms(terms: TimetableTerm[]): TimetableTerm[] {
  return terms.slice().sort((left, right) => {
    if (left.isActive) {
      return -1;
    }

    if (right.isActive) {
      return 1;
    }

    const dateComparison = (right.startDate ?? '').localeCompare(left.startDate ?? '');

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return (
      right.year - left.year ||
      getTimetableTermKindKey(left.kind).localeCompare(getTimetableTermKindKey(right.kind))
    );
  });
}

export function normalizeTimetableTermsByYearAndKind(
  userId: string,
  terms: TimetableTerm[],
): {
  terms: TimetableTerm[];
  termIdMap: Map<string, string>;
  obsoleteTermIds: string[];
} {
  const now = new Date().toISOString();
  const sourceTerms = terms.length > 0 ? terms : [createDefaultTimetableTerm(userId)];
  const groupedTerms = new Map<string, TimetableTerm[]>();
  const termIdMap = new Map<string, string>();

  sourceTerms.forEach((term) => {
    const stableId =
      term.kind === 'custom' ? term.id : createTimetableTermId(term.year, term.kind);
    const group = groupedTerms.get(stableId) ?? [];

    group.push(term);
    groupedTerms.set(stableId, group);
    termIdMap.set(term.id, stableId);
  });

  const activeSourceTerm = resolveActiveTimetableTerm(sourceTerms).term;
  if (!activeSourceTerm) {
    throw new Error('Timetable term normalization requires at least one source term.');
  }
  const activeStableId = termIdMap.get(activeSourceTerm.id) ?? (
    activeSourceTerm.kind === 'custom'
      ? activeSourceTerm.id
      : createTimetableTermId(activeSourceTerm.year, activeSourceTerm.kind)
  );

  if (!termIdMap.has('default')) {
    termIdMap.set('default', activeStableId);
  }

  const obsoleteTermIds: string[] = [];
  const normalizedTerms = Array.from(groupedTerms.entries()).map(([stableId, group]) => {
    const latest = pickLatestTimetableTerm(group);

    group.forEach((term) => {
      if (term.id !== stableId) {
        obsoleteTermIds.push(term.id);
      }
    });

    return {
      ...latest,
      id: stableId,
      userId,
      label: createTimetableTermLabel(latest.year, latest.kind, latest.label),
      isActive: stableId === activeStableId,
      updatedAt: latest.id === stableId ? latest.updatedAt : now,
    };
  });

  return {
    terms: sortTimetableTerms(normalizedTerms),
    termIdMap,
    obsoleteTermIds,
  };
}

export function remapTimetableTermId(
  termId: string | undefined,
  termIdMap: Map<string, string>,
): string {
  const normalizedTermId = termId?.trim() || 'default';

  return termIdMap.get(normalizedTermId) ?? normalizedTermId;
}

export function mergeTimetablePeriodsByTermAndNumber(
  periods: TimetablePeriod[],
): {
  periods: TimetablePeriod[];
  obsoletePeriodIds: string[];
} {
  const periodByKey = new Map<string, TimetablePeriod>();
  const obsoletePeriodIds: string[] = [];

  periods.forEach((period) => {
    const key = `${period.termId}:${period.periodNumber}`;
    const current = periodByKey.get(key);

    if (!current || period.updatedAt.localeCompare(current.updatedAt) > 0) {
      if (current) {
        obsoletePeriodIds.push(current.id);
      }
      periodByKey.set(key, period);
      return;
    }

    obsoletePeriodIds.push(period.id);
  });

  return {
    periods: Array.from(periodByKey.values()).sort(
      (left, right) =>
        left.termId.localeCompare(right.termId) ||
        left.periodNumber - right.periodNumber,
    ),
    obsoletePeriodIds,
  };
}
