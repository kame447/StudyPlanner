import type {
  SemanticDecisionV5,
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function nonEmptyId(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function decisionTargetError(
  decision: SemanticDecisionV5,
  index: number,
): string | null {
  if (decision.target.kind === 'proposal') {
    return nonEmptyId(decision.target.publicId)
      ? null
      : `document.decisions[${index}].target:proposal-requires-public-id`;
  }

  return nonEmptyId(decision.target.publicId) || nonEmptyId(decision.target.localId)
    ? null
    : `document.decisions[${index}].target:requires-machine-addressable-id`;
}

export function validateWeeklyPlanningDecisionTargetReferencesV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  return document.decisions.flatMap((decision, index) => {
    const error = decisionTargetError(decision, index);
    return error ? [error] : [];
  });
}
