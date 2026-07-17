import type {
  AddFixedEventCommand,
  AddUnavailableCommand,
  MarkCompletedUnitsCommand,
  MarkCompletionTargetCommand,
  NoteProgressBoundaryCommand,
  NoteUncertaintyCommand,
  NormalizedSetPendingPlanningRangeCommand,
  SetPriorityPolicyCommand,
  SetExamScopeCommand,
  SetPlanningRangeCommand,
  SetPendingPlanningRangeCommand,
  SetStudyGoalCommand,
  SetUnitRateCommand,
  UpdateLifeConstraintCommand,
} from './weeklyPlanningCommandTypes';
import type {
  ExamPrepScope,
  LifeConstraint,
  PlanningIntakeUncertainty,
  PlanningRange,
  PriorityPolicy,
  StudyProgress,
  StudyTaskScope,
  UnitRateEstimate,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import { nextWeekScope } from './weeklyPlanningScopeParsing';

export function toLifeConstraintFromAddUnavailableCommand(
  command: AddUnavailableCommand,
): LifeConstraint {
  return {
    kind: 'unavailable',
    date: command.range.date,
    start: command.range.start,
    end: command.range.end,
    hardness: command.range.hardness,
    rawText: command.sourceSegment ?? command.sourceText,
  };
}

export function toLifeConstraintFromAddFixedEventCommand(
  command: AddFixedEventCommand,
): LifeConstraint {
  return {
    kind: 'fixed_event',
    date: command.event.date,
    start: command.event.start,
    end: command.event.end,
    durationMinutes: command.event.durationMinutes,
    hardness: command.event.hardness,
    rawText: command.sourceSegment ?? command.sourceText,
  };
}

export function toLifeConstraintFromUpdateLifeConstraintCommand(
  command: UpdateLifeConstraintCommand,
): LifeConstraint {
  return {
    kind: command.kind,
    date: command.constraint.date,
    start: command.constraint.start,
    end: command.constraint.end,
    durationMinutes: command.constraint.durationMinutes,
    studyAvailableStart: command.constraint.studyAvailableStart,
    hardness: command.constraint.hardness,
    rawText: command.sourceSegment ?? command.sourceText,
  };
}

export function toPriorityPolicyFromSetPriorityPolicyCommand(
  command: SetPriorityPolicyCommand,
): PriorityPolicy {
  return command.policy;
}

export function toUncertaintyFromNoteUncertaintyCommand(
  command: NoteUncertaintyCommand,
): PlanningIntakeUncertainty {
  return command.uncertainty;
}

export function toStudyProgressFromMarkCompletedUnitsCommand(
  command: MarkCompletedUnitsCommand,
): StudyProgress {
  return {
    field: command.field,
    completedYears: command.completedYears,
    ambiguity: 'none',
    rawText: command.sourceSegment ?? command.sourceText,
  };
}

export function toStudyProgressFromMarkCompletionTargetCommand(
  command: MarkCompletionTargetCommand,
): StudyProgress {
  return {
    field: command.field,
    completionTarget: command.target,
    ambiguity: 'none',
    rawText: command.sourceSegment ?? command.sourceText,
  };
}

export function toStudyProgressFromNoteProgressBoundaryCommand(
  command: NoteProgressBoundaryCommand,
): StudyProgress {
  return {
    field: command.field,
    completionBoundaryYear: command.boundaryYear,
    ambiguity: command.ambiguity,
    rawText: command.sourceSegment ?? command.sourceText,
  };
}

export function normalizeSetPendingPlanningRangeCommand(
  command: SetPendingPlanningRangeCommand,
  context: WeeklyPlanningIntakeContext,
): NormalizedSetPendingPlanningRangeCommand {
  if (command.pending.scope.kind === 'named_future_period') {
    return {
      ...command,
      pending: {
        ...command.pending,
        scope: { ...command.pending.scope },
      },
    };
  }

  const normalizedScope = nextWeekScope(context);

  return {
    ...command,
    pending: {
      ...command.pending,
      scope: {
        ...command.pending.scope,
        windowStartDate: command.pending.scope.windowStartDate ?? normalizedScope.windowStartDate,
        windowEndDate: command.pending.scope.windowEndDate ?? normalizedScope.windowEndDate,
      },
      durationDays: command.pending.durationDays ?? (command.pending.planningEndDateTime ? undefined : 7),
    },
  };
}

export function toStudyTaskScopeFromSetStudyGoalCommand(
  command: SetStudyGoalCommand,
): StudyTaskScope {
  const unit = command.goal.unit ?? 'unknown';
  const amount = command.goal.amount;
  const isTimeUnit = unit === 'minutes' || unit === 'hours';

  return {
    title: command.goal.title,
    subject: command.goal.subject,
    unit,
    amount,
    rawText: command.sourceSegment ?? command.sourceText,
    requiresTimeEstimate: amount === undefined || !isTimeUnit,
    source: 'command',
  };
}

export function toUnitRateFromSetUnitRateCommand(
  command: SetUnitRateCommand,
): UnitRateEstimate {
  return command.unitRate;
}
function calendarDayCount(startDateTime: string, endDateTime: string): number | undefined {
  const start = new Date(startDateTime.slice(0, 10) + 'T00:00:00');
  const end = new Date(endDateTime.slice(0, 10) + 'T00:00:00');
  const difference = Math.round((end.getTime() - start.getTime()) / 86400000);

  return Number.isFinite(difference) ? Math.max(1, difference + 1) : undefined;
}

export function toPlanningRangeFromSetPlanningRangeCommand(
  command: SetPlanningRangeCommand,
  normalizeMissingDayCount = true,
): PlanningRange {
  const range = command.range;
  if (!normalizeMissingDayCount || range.calendarDayCount || !range.startDateTime || !range.endDateTime) {
    return range;
  }

  const normalizedDayCount = calendarDayCount(range.startDateTime, range.endDateTime);
  return normalizedDayCount
    ? { ...range, calendarDayCount: normalizedDayCount }
    : range;
}
export function toExamScopeFromSetExamScopeCommand(
  command: SetExamScopeCommand,
): ExamPrepScope {
  return command.scope;
}
