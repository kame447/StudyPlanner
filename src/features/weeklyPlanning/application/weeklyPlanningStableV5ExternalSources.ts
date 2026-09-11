import {
  createScheduleOccurrenceProjection,
  type ScheduleOccurrence,
  type ScheduleOccurrenceProjection,
} from '../../../domain/scheduleOccurrence';
import type {
  MonthEvent,
  Plan,
  ScheduleTemplate,
  TimetableTerm,
} from '../../../types/domain';
import type {
  ExternalConstraintSourceSnapshot,
} from '../semantic/weeklyPlanningAvailabilityResolver';

function failedSource(
  kind: 'existing_plans' | 'timetable',
  ownerId: string,
): ExternalConstraintSourceSnapshot {
  return {
    kind,
    status: 'failure',
    ownerId,
    activeSourceId: null,
    failureKind: 'invalid_response',
    attemptCount: 1,
  };
}

function sourceFromProjection(params: {
  kind: 'existing_plans' | 'timetable';
  ownerId: string;
  activeSourceId: string;
  projection: ScheduleOccurrenceProjection;
  includeOccurrence: (occurrence: ScheduleOccurrence) => boolean;
  timeZone: string;
}): ExternalConstraintSourceSnapshot {
  // Projection issues are ownership/range integrity failures. Fail both local
  // schedule sources closed rather than guessing which downstream source can
  // safely ignore a malformed mixed projection.
  if (params.projection.issues.length > 0) {
    return failedSource(params.kind, params.ownerId);
  }

  return {
    kind: params.kind,
    status: 'success',
    ownerId: params.ownerId,
    activeSourceId: params.activeSourceId,
    attemptCount: 1,
    events: params.projection.occurrences
      .filter(
        (occurrence) => occurrence.busy && params.includeOccurrence(occurrence),
      )
      .map((occurrence) => ({
        // Keep the source entity identity stable for downstream diagnostics. The
        // occurrence itself remains uniquely identified inside the projection.
        eventId: occurrence.source.id,
        ownerId: occurrence.ownerId,
        start: occurrence.start,
        end: occurrence.end,
        timeZone: params.timeZone,
        constraintLevel: 'hard' as const,
      })),
  };
}

function isPersistedScheduleOccurrence(occurrence: ScheduleOccurrence): boolean {
  return (
    occurrence.source.backingKind === 'plan' ||
    occurrence.source.backingKind === 'month-event'
  );
}

function isTimetableTemplateOccurrence(occurrence: ScheduleOccurrence): boolean {
  return occurrence.source.backingKind === 'timetable-template';
}

export function createStableV5ExternalConstraintSources(params: {
  ownerId: string;
  plans: readonly Plan[];
  monthEvents?: readonly MonthEvent[];
  templates: readonly ScheduleTemplate[];
  timetableTermId?: string;
  timetableTerm?: TimetableTerm | null;
  timetableTerms?: readonly TimetableTerm[];
  horizon: { startDate: string; endDate: string } | null;
  timeZone: string;
}): ExternalConstraintSourceSnapshot[] {
  const projection = params.horizon
    ? createScheduleOccurrenceProjection({
        ownerId: params.ownerId,
        startDate: params.horizon.startDate,
        endDate: params.horizon.endDate,
        plans: params.plans,
        monthEvents: params.monthEvents,
        scheduleTemplates: params.templates,
        timetableTermId: params.timetableTermId,
        timetableTerm: params.timetableTerm,
        timetableTerms: params.timetableTerms,
      })
    : { occurrences: [], issues: [] };
  const sourceTermId =
    params.timetableTermId ?? params.timetableTerm?.id ?? 'auto';

  return [
    sourceFromProjection({
      kind: 'existing_plans',
      ownerId: params.ownerId,
      activeSourceId: 'studyplanner-existing-plans',
      projection,
      includeOccurrence: isPersistedScheduleOccurrence,
      timeZone: params.timeZone,
    }),
    sourceFromProjection({
      kind: 'timetable',
      ownerId: params.ownerId,
      activeSourceId: `studyplanner-timetable:${sourceTermId}`,
      projection,
      includeOccurrence: isTimetableTemplateOccurrence,
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
