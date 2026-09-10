import { createScheduleOccurrenceProjection, type ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { addDays } from './date';
import type {
  MonthEvent,
  Plan,
  PlanType,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';

function occurrenceCoversDate(occurrence: ScheduleOccurrence, date: string): boolean {
  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDays(date, 1)}T00:00`;
  const start = `${occurrence.start.date}T${occurrence.start.time}`;
  const end = `${occurrence.end.date}T${occurrence.end.time}`;
  return end > dayStart && start < dayEnd;
}

function planTypeForOccurrence(occurrence: ScheduleOccurrence): PlanType {
  switch (occurrence.category) {
    case 'study':
      return 'study';
    case 'exam':
      return 'mock-exam';
    case 'cram-school':
      return 'cram-school';
    case 'deadline':
      return 'deadline';
    case 'class':
    case 'school':
      return 'school-event';
    default:
      return 'other';
  }
}

function projectOccurrenceAsReadOnlyPlan(
  occurrence: ScheduleOccurrence,
  date: string,
): Plan {
  const startTime = occurrence.start.date === date ? occurrence.start.time : '00:00';
  const endTime = occurrence.end.date === date ? occurrence.end.time : '24:00';

  return {
    id: `${occurrence.id}:home:${date}`,
    seriesId: occurrence.id,
    userId: occurrence.ownerId,
    title: occurrence.title,
    subject: occurrence.subject,
    date,
    startTime,
    endTime,
    repeat: 'none',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: planTypeForOccurrence(occurrence),
    memo: '',
    createdAt: '',
    updatedAt: '',
    sourceType: occurrence.planSourceType ?? 'manual',
    sourceId: occurrence.source.id,
    occurrenceDate: date,
    ...(occurrence.busy === false ? { busy: false } : {}),
  };
}

export function augmentHomePlansWithScheduleOccurrences({
  ownerId,
  plans,
  monthEvents,
  scheduleTemplates,
  timetableTermId,
  timetableTerm,
  timetableTerms,
  startDate,
}: {
  ownerId: string;
  plans: readonly Plan[];
  monthEvents: readonly MonthEvent[];
  scheduleTemplates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
  startDate: string;
}): Plan[] {
  const endDate = addDays(startDate, 7);
  const projection = createScheduleOccurrenceProjection({
    ownerId,
    startDate,
    endDate,
    plans,
    monthEvents,
    scheduleTemplates,
    timetableTermId,
    timetableTerm,
    timetableTerms,
  });
  const syntheticPlans: Plan[] = [];

  for (const occurrence of projection.occurrences) {
    // Persisted Plan-backed occurrences are already represented by `plans` and
    // must keep their original ids for Actual linkage and study metrics.
    if (occurrence.source.backingKind === 'plan') continue;

    let date = startDate;
    while (date <= endDate) {
      if (occurrenceCoversDate(occurrence, date)) {
        syntheticPlans.push(projectOccurrenceAsReadOnlyPlan(occurrence, date));
      }
      date = addDays(date, 1);
    }
  }

  return [...plans, ...syntheticPlans];
}
