import { createScheduleOccurrenceProjection, scheduleOccurrenceCoversDate, scheduleOccurrenceTimesForDate, type ScheduleOccurrence } from '../domain/scheduleOccurrence';
import { getScheduleOccurrenceColor, type ScheduleColorPresentation } from './scheduleEventColor';
import { addDays, startOfWeek } from './date';
import type { StudyProgressPlan } from './studyProgressPolicy';
import type {
  MonthEvent,
  Plan,
  PlanType,
  ScheduleTemplate,
  TimetableTerm,
} from '../types/domain';

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
): StudyProgressPlan & ScheduleColorPresentation {
  const { startTime, endTime } = scheduleOccurrenceTimesForDate(occurrence, date);

  return {
    id: `${occurrence.id}:home:${date}`,
    scheduleSource: occurrence.source,
    scheduleColor: getScheduleOccurrenceColor(occurrence),
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
  const projectionStartDate = startOfWeek(startDate);
  const projection = createScheduleOccurrenceProjection({
    ownerId,
    startDate: projectionStartDate,
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

    let date = projectionStartDate;
    while (date <= endDate) {
      if (scheduleOccurrenceCoversDate(occurrence, date)) {
        syntheticPlans.push(projectOccurrenceAsReadOnlyPlan(occurrence, date));
      }
      date = addDays(date, 1);
    }
  }

  return [...plans, ...syntheticPlans];
}
