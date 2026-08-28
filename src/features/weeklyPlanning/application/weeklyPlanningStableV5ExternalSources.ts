import { getRecurrenceWeekday } from '../../../lib/planRecurrence';
import { resolveTimetableTermForDate } from '../../../lib/timetableCalendar';
import { buildTimetableImportCandidates } from '../../../lib/timetableImport';
import type { Plan, ScheduleTemplate, TimetableTerm } from '../../../types/domain';
import type { ExternalConstraintSourceSnapshot } from '../semantic/weeklyPlanningAvailabilityResolver';
import { listCalendarDatesInclusive } from '../semantic/weeklyPlanningCalendarResolver';

function existingPlanSource(params: {
  ownerId: string;
  plans: readonly Plan[];
  horizon: { startDate: string; endDate: string } | null;
  timeZone: string;
}): ExternalConstraintSourceSnapshot {
  const dates = params.horizon
    ? new Set(listCalendarDatesInclusive(params.horizon.startDate, params.horizon.endDate) ?? [])
    : new Set<string>();
  return {
    kind: 'existing_plans',
    status: 'success',
    ownerId: params.ownerId,
    activeSourceId: 'studyplanner-existing-plans',
    attemptCount: 1,
    events: params.plans
      .filter((plan) => dates.has(plan.date))
      .map((plan) => ({
        eventId: plan.id,
        ownerId: params.ownerId,
        start: { date: plan.date, time: plan.startTime },
        end: { date: plan.date, time: plan.endTime },
        timeZone: params.timeZone,
        constraintLevel: 'hard' as const,
      })),
  };
}

function timetableSource(params: {
  ownerId: string;
  templates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
  horizon: { startDate: string; endDate: string } | null;
  timeZone: string;
}): ExternalConstraintSourceSnapshot {
  const dates = params.horizon
    ? listCalendarDatesInclusive(params.horizon.startDate, params.horizon.endDate) ?? []
    : [];
  const terms = params.timetableTerms ?? (params.timetableTerm ? [params.timetableTerm] : []);
  const sourceTermId = params.timetableTermId ?? params.timetableTerm?.id ?? 'auto';

  return {
    kind: 'timetable',
    status: 'success',
    ownerId: params.ownerId,
    activeSourceId: `studyplanner-timetable:${sourceTermId}`,
    attemptCount: 1,
    events: dates.flatMap((date) => {
      const term = terms.length > 0
        ? resolveTimetableTermForDate(date, terms, params.timetableTermId)
        : params.timetableTerm ?? null;
      const termId = term?.id ?? (terms.length === 0 ? params.timetableTermId ?? 'default' : null);

      if (!termId) {
        return [];
      }

      const templates = params.templates.filter(
        (template) => (template.termId || 'default') === termId,
      );

      return buildTimetableImportCandidates({
        templates,
        date,
        weekday: getRecurrenceWeekday(date),
        termId,
        term,
      }).map((candidate) => ({
        eventId: candidate.sourceId,
        ownerId: params.ownerId,
        start: { date, time: candidate.startTime },
        end: { date, time: candidate.endTime },
        timeZone: params.timeZone,
        constraintLevel: 'hard' as const,
      }));
    }),
  };
}

export function createStableV5ExternalConstraintSources(params: {
  ownerId: string;
  plans: readonly Plan[];
  templates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
  horizon: { startDate: string; endDate: string } | null;
  timeZone: string;
}): ExternalConstraintSourceSnapshot[] {
  return [
    existingPlanSource({
      ownerId: params.ownerId,
      plans: params.plans,
      horizon: params.horizon,
      timeZone: params.timeZone,
    }),
    timetableSource({
      ownerId: params.ownerId,
      templates: params.templates,
      timetableTermId: params.timetableTermId,
      timetableTerm: params.timetableTerm,
      timetableTerms: params.timetableTerms,
      horizon: params.horizon,
      timeZone: params.timeZone,
    }),
    {
      kind: 'calendar',
      status: 'failure',
      ownerId: params.ownerId,
      activeSourceId: null,
      failureKind: 'source_not_configured',
      attemptCount: 1,
    },
  ];
}
