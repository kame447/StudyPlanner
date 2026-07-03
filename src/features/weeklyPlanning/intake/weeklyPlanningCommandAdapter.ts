import type {
  AddFixedEventCommand,
  AddUnavailableCommand,
  MarkCompletedUnitsCommand,
  NoteProgressBoundaryCommand,
  NoteUncertaintyCommand,
  SetPriorityPolicyCommand,
  SetExamScopeCommand,
  SetPlanningRangeCommand,
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
  UnitRateEstimate,
} from './weeklyPlanningIntakeTypes';

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

export function toUnitRateFromSetUnitRateCommand(
  command: SetUnitRateCommand,
): UnitRateEstimate {
  return command.unitRate;
}
export function toPlanningRangeFromSetPlanningRangeCommand(
  command: SetPlanningRangeCommand,
): PlanningRange {
  return command.range;
}
export function toExamScopeFromSetExamScopeCommand(
  command: SetExamScopeCommand,
): ExamPrepScope {
  return command.scope;
}