import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import type {
  ConstraintSourceReferenceResolution,
  InterpretedCommandCandidate,
  InterpreterStateSummary,
} from './weeklyPlanningInterpreterTypes';
import type { ConstraintSourceKind } from './weeklyPlanningIntakeTypes';

type UseConstraintSourceCommand = Extract<ParsedWeeklyPlanningCommand, { type: 'use_constraint_source' }>;

interface ReferenceResolutionInput {
  candidates: InterpretedCommandCandidate[];
  stateSummary: InterpreterStateSummary;
}

function activeConstraintSources(summary: InterpreterStateSummary): ConstraintSourceKind[] {
  const availability = summary.availableConstraintSources;
  if (!availability) return [];

  return [
    availability.timetable ? 'timetable' : undefined,
    availability.existingPlans ? 'existing_plans' : undefined,
    availability.calendar ? 'calendar' : undefined,
  ].filter((source): source is ConstraintSourceKind => Boolean(source));
}

function requestConstraintSourceClarification(
  command: UseConstraintSourceCommand,
): ParsedWeeklyPlanningCommand {
  return {
    type: 'request_clarification',
    target: 'unresolved_slot',
    ref: 'constraint_source',
    sourceText: command.sourceText,
    sourceSegment: command.sourceSegment,
    confidence: 'high',
  };
}

function resolveConstraintSourceReference(params: {
  command: UseConstraintSourceCommand;
  stateSummary: InterpreterStateSummary;
}): ConstraintSourceReferenceResolution {
  const activeSources = activeConstraintSources(params.stateSummary);
  if (activeSources.includes(params.command.source.kind)) {
    return {
      status: 'resolved',
      resolvedKind: params.command.source.kind,
      reason: 'typed-source-available',
    };
  }

  return {
    status: 'unresolved',
    candidateKinds: activeSources,
    reason: 'typed-source-unavailable',
    clarificationRequest: requestConstraintSourceClarification(params.command),
  };
}

export function resolveConstraintSourceReferences(
  params: ReferenceResolutionInput,
): InterpretedCommandCandidate[] {
  return params.candidates.map((candidate) => {
    if (candidate.command.type !== 'use_constraint_source') return candidate;

    return {
      ...candidate,
      constraintSourceResolution: resolveConstraintSourceReference({
        command: candidate.command,
        stateSummary: params.stateSummary,
      }),
    };
  });
}
