import type {
  ScheduleTemplate,
  TimetableAlternatingWeek,
  TimetableTerm,
} from '../types/domain';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function parseIsoDateUtc(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function startOfIsoWeekUtc(date: Date): Date {
  const weekday = date.getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;

  return new Date(date.getTime() - daysFromMonday * DAY_MS);
}

function weekDistance(
  date: string,
  anchorDate: string | null | undefined,
): number | null {
  const parsedDate = parseIsoDateUtc(date);
  const parsedAnchor = parseIsoDateUtc(anchorDate);

  if (!parsedDate || !parsedAnchor) {
    return null;
  }

  const dateWeek = startOfIsoWeekUtc(parsedDate).getTime();
  const anchorWeek = startOfIsoWeekUtc(parsedAnchor).getTime();

  return Math.round((dateWeek - anchorWeek) / WEEK_MS);
}

function hasExplicitTimetableRange(term: TimetableTerm): boolean {
  return isIsoCalendarDate(term.startDate) || isIsoCalendarDate(term.endDate);
}

function compareTimetableTermPriority(left: TimetableTerm, right: TimetableTerm): number {
  return (
    Number(right.isActive) - Number(left.isActive) ||
    (right.startDate ?? '').localeCompare(left.startDate ?? '') ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

export function isIsoCalendarDate(value: string | null | undefined): value is string {
  return parseIsoDateUtc(value) !== null;
}

export function isDateWithinTimetableTerm(
  date: string,
  term: TimetableTerm | null | undefined,
): boolean {
  if (!isIsoCalendarDate(date)) {
    return false;
  }

  if (!term) {
    return true;
  }

  if (term.startDate && isIsoCalendarDate(term.startDate) && date < term.startDate) {
    return false;
  }

  if (term.endDate && isIsoCalendarDate(term.endDate) && date > term.endDate) {
    return false;
  }

  return true;
}

export function resolveTimetableTermForDate(
  date: string,
  terms: readonly TimetableTerm[],
  preferredTermId?: string | null,
): TimetableTerm | null {
  if (!isIsoCalendarDate(date)) {
    return null;
  }

  const preferredTerm = preferredTermId
    ? terms.find((term) => term.id === preferredTermId) ?? null
    : null;

  if (
    preferredTerm &&
    hasExplicitTimetableRange(preferredTerm) &&
    isDateWithinTimetableTerm(date, preferredTerm)
  ) {
    return preferredTerm;
  }

  const boundedMatch = terms
    .filter(
      (term) => hasExplicitTimetableRange(term) && isDateWithinTimetableTerm(date, term),
    )
    .slice()
    .sort(compareTimetableTermPriority)[0];

  if (boundedMatch) {
    return boundedMatch;
  }

  if (preferredTerm && !hasExplicitTimetableRange(preferredTerm)) {
    return preferredTerm;
  }

  return terms
    .filter(
      (term) => !hasExplicitTimetableRange(term) && isDateWithinTimetableTerm(date, term),
    )
    .slice()
    .sort(compareTimetableTermPriority)[0] ?? null;
}

export function resolveTimetableAlternatingWeek(
  date: string,
  term: TimetableTerm | null | undefined,
): TimetableAlternatingWeek | null {
  if (!term?.usesAlternatingWeeks) {
    return null;
  }

  const anchorDate =
    term.alternatingWeekAnchorDate && isIsoCalendarDate(term.alternatingWeekAnchorDate)
      ? term.alternatingWeekAnchorDate
      : term.startDate;
  const distance = weekDistance(date, anchorDate);

  if (distance === null) {
    return null;
  }

  return Math.abs(distance % 2) === 0 ? 'a' : 'b';
}

export function isBiweeklyTemplateActiveOnDate(
  template: ScheduleTemplate,
  date: string,
): boolean {
  if (template.weekInterval !== 2) {
    return true;
  }

  const distance = weekDistance(date, template.weekIntervalAnchorDate);

  if (distance === null) {
    return false;
  }

  return Math.abs(distance % 2) === 0;
}

export function isScheduleTemplateActiveOnDate(
  template: ScheduleTemplate,
  date: string,
  term?: TimetableTerm | null,
): boolean {
  if (!isDateWithinTimetableTerm(date, term)) {
    return false;
  }

  if (!isBiweeklyTemplateActiveOnDate(template, date)) {
    return false;
  }

  const alternatingWeek = resolveTimetableAlternatingWeek(date, term);
  const templateWeek = template.alternatingWeek ?? 'both';

  if (alternatingWeek && templateWeek !== 'both' && templateWeek !== alternatingWeek) {
    return false;
  }

  return true;
}
