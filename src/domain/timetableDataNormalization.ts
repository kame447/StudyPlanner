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
  now = new Date().toISOString(),
): string {
  const normalizedYear = Number.isFinite(year) ? Math.round(year) : new Date(now).getFullYear();
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

function createLegacyTimetableTermId(
  year: number,
  kind: TimetableTermKind,
  now = new Date().toISOString(),
): string {
  const normalizedYear = Number.isFinite(year)
    ? Math.round(year)
    : new Date(now).getFullYear();

  return `${normalizedYear}-${getTimetableTermKindKey(kind)}`;
}

/** A document-safe, injective encoding of an authenticated owner's Unicode UID. */
function encodeTimetableOwner(userId: string): string {
  const bytes = new TextEncoder().encode(userId);
  if (!userId || [...userId].length > 128 || new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== userId) {
    throw new Error('Timetable identity requires a valid owner UID.');
  }
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createTimetableTermId(
  userId: string,
  year: number,
  kind: TimetableTermKind,
  now = new Date().toISOString(),
): string {
  return `timetable-term:${encodeTimetableOwner(userId)}:${createLegacyTimetableTermId(year, kind, now)}`;
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

function createDefaultTimetableTerm(userId: string, now: string): TimetableTerm {
  const year = new Date(now).getFullYear();

  return {
    id: createTimetableTermId(userId, year, 'fullYear', now),
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
  now = new Date().toISOString(),
): {
  terms: TimetableTerm[];
  termIdMap: Map<string, string>;
  obsoleteTermIds: string[];
} {
  if (terms.some((term) => term.userId !== userId)) {
    throw new Error('Timetable normalization cannot migrate another owner’s records.');
  }
  const sourceTerms = terms.length > 0 ? terms : [createDefaultTimetableTerm(userId, now)];
  const groupedTerms = new Map<string, TimetableTerm[]>();
  const termIdMap = new Map<string, string>();

  sourceTerms.forEach((term) => {
    const stableId =
      term.kind === 'custom' ? term.id : createTimetableTermId(userId, term.year, term.kind, now);
    const group = groupedTerms.get(stableId) ?? [];
    if (group.some((candidate) => (candidate.kind === 'custom') !== (term.kind === 'custom'))) {
      throw new Error('Timetable canonical identity conflicts with a custom period.');
    }

    group.push(term);
    groupedTerms.set(stableId, group);
    termIdMap.set(term.id, stableId);
  });

  // Historical rows can reference the old year/kind key even when their term
  // is missing (including an account whose original default write was denied).
  // Explicit source IDs, especially custom IDs, take precedence over aliases.
  sourceTerms.forEach((term) => {
    if (term.kind === 'custom') return;
    const legacyId = createLegacyTimetableTermId(term.year, term.kind, now);
    if (!termIdMap.has(legacyId)) {
      termIdMap.set(legacyId, createTimetableTermId(userId, term.year, term.kind, now));
    }
  });

  const activeSourceTerm = resolveActiveTimetableTerm(sourceTerms).term;
  if (!activeSourceTerm) {
    throw new Error('Timetable term normalization requires at least one source term.');
  }
  const activeStableId = termIdMap.get(activeSourceTerm.id) ?? (
    activeSourceTerm.kind === 'custom'
      ? activeSourceTerm.id
      : createTimetableTermId(userId, activeSourceTerm.year, activeSourceTerm.kind, now)
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
      label: createTimetableTermLabel(latest.year, latest.kind, latest.label, now),
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
