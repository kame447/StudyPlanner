import type { TimetableTerm } from '../types/domain';

export interface ActiveTimetableTermSelection {
  term: TimetableTerm | null;
  termId: string;
}

function latestTimetableTerm(terms: readonly TimetableTerm[]): TimetableTerm | null {
  if (terms.length === 0) return null;
  return terms
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function resolveActiveTimetableTerm(
  terms: readonly TimetableTerm[],
): ActiveTimetableTermSelection {
  const term = terms.find((candidate) => candidate.isActive)
    ?? terms.find((candidate) => candidate.id === 'default')
    ?? latestTimetableTerm(terms);

  return {
    term,
    termId: term?.id ?? 'default',
  };
}
