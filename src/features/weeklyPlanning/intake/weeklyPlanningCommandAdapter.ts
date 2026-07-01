import type { AddUnavailableCommand } from './weeklyPlanningCommandTypes';
import type { LifeConstraint } from './weeklyPlanningIntakeTypes';

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