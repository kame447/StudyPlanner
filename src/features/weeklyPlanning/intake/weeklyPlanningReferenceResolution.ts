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
  userText: string;
  stateSummary: InterpreterStateSummary;
}

const TIMETABLE_EVIDENCE = [
  '時間割',
  '授業',
  '講義',
  '今学期',
  '予定表',
  '登録済みの授業',
  'いつもの授業',
  '普段通りの授業',
];

const EXISTING_PLANS_EVIDENCE = [
  '保存済みの予定',
  '保存してある予定',
  'アプリに保存してある予定',
  'アプリに保存済みの予定',
  '登録してある予定',
  '登録済みの予定',
  'もう登録してある予定',
  '保存済みスケジュール',
  '保存済みのスケジュール',
];

const AMBIGUOUS_CONTAINER_EVIDENCE = [
  'カレンダー',
];

function activeConstraintSources(summary: InterpreterStateSummary): ConstraintSourceKind[] {
  const availability = summary.availableConstraintSources;
  if (!availability) {
    return [];
  }

  return [
    availability.timetable ? 'timetable' : undefined,
    availability.existingPlans ? 'existing_plans' : undefined,
  ].filter((source): source is ConstraintSourceKind => Boolean(source));
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function sourceEvidenceKinds(text: string): Set<ConstraintSourceKind> {
  const kinds = new Set<ConstraintSourceKind>();

  if (includesAny(text, TIMETABLE_EVIDENCE)) {
    kinds.add('timetable');
  }

  if (includesAny(text, EXISTING_PLANS_EVIDENCE)) {
    kinds.add('existing_plans');
  }

  return kinds;
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
  userText: string;
  stateSummary: InterpreterStateSummary;
}): ConstraintSourceReferenceResolution {
  const text = params.command.sourceSegment ?? params.command.sourceText ?? params.userText;
  const activeSources = activeConstraintSources(params.stateSummary);
  const evidenceKinds = sourceEvidenceKinds(text);
  const hasAmbiguousContainer = includesAny(text, AMBIGUOUS_CONTAINER_EVIDENCE);

  if (hasAmbiguousContainer && activeSources.length > 1) {
    return {
      status: 'multiple',
      candidateKinds: activeSources,
      reason: 'ambiguous-container-source',
      clarificationRequest: requestConstraintSourceClarification(params.command),
    };
  }

  if (evidenceKinds.size === 1) {
    const [kind] = Array.from(evidenceKinds);
    if (kind === params.command.source.kind) {
      return {
        status: 'resolved',
        resolvedKind: kind,
        reason: 'explicit-source-evidence',
      };
    }

    return {
      status: 'multiple',
      candidateKinds: Array.from(new Set([kind, params.command.source.kind])),
      reason: 'source-evidence-command-mismatch',
      clarificationRequest: requestConstraintSourceClarification(params.command),
    };
  }

  if (evidenceKinds.size > 1) {
    return {
      status: 'multiple',
      candidateKinds: Array.from(evidenceKinds),
      reason: 'multiple-source-evidence',
      clarificationRequest: requestConstraintSourceClarification(params.command),
    };
  }

  if (activeSources.length === 1 && activeSources[0] === params.command.source.kind) {
    return {
      status: 'resolved',
      resolvedKind: activeSources[0],
      reason: 'single-available-source',
    };
  }

  return {
    status: activeSources.length > 1 ? 'multiple' : 'unresolved',
    candidateKinds: activeSources,
    reason: activeSources.length > 1 ? 'no-unique-source-evidence' : 'no-source-evidence',
    clarificationRequest: requestConstraintSourceClarification(params.command),
  };
}

function preserveSourceUserText(
  source: InterpretedCommandCandidate,
  target: InterpretedCommandCandidate,
): InterpretedCommandCandidate {
  const descriptor = Object.getOwnPropertyDescriptor(source, 'sourceUserText');
  if (descriptor) {
    Object.defineProperty(target, 'sourceUserText', descriptor);
  }
  return target;
}

export function resolveConstraintSourceReferences(
  params: ReferenceResolutionInput,
): InterpretedCommandCandidate[] {
  return params.candidates.map((candidate) => {
    if (candidate.command.type !== 'use_constraint_source') {
      return candidate;
    }

    return preserveSourceUserText(candidate, {
      ...candidate,
      constraintSourceResolution: resolveConstraintSourceReference({
        command: candidate.command,
        userText: params.userText,
        stateSummary: params.stateSummary,
      }),
    });
  });
}
