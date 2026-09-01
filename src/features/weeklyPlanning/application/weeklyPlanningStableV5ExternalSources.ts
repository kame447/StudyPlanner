import {
  createScheduleOccurrenceProjection,
  type ScheduleOccurrenceProjection,
  type ScheduleOccurrenceSourceKind,
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

function hasProjectionIssue(
  projection: ScheduleOccurrenceProjection,
  sourceKinds: readonly ScheduleOccurrenceSourceKind[],
): boolean {
  return projection.issues.some(
    (issue) =>
      issue.sourceKind === null ||
      sourceKinds.includes(issue.sourceKind),
  );
}

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
  sourceKinds: readonly ScheduleOccurrenceSourceKind[];
  timeZone: string;
}): ExternalConstraintSourceSnapshot {
  if (hasProjectionIssue(params.projection, params.sourceKinds)) {
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
        (occurrence) =>
          occurrence.busy && params.sourceKinds.includes(occurrence.source.kind),
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
      sourceKinds: ['plan', 'month-event'],
      timeZone: params.timeZone,
    }),
    sourceFromProjection({
      kind: 'timetable',
      ownerId: params.ownerId,
      activeSourceId: `studyplanner-timetable:${sourceTermId}`,
      projection,
      sourceKinds: ['timetable'],
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
