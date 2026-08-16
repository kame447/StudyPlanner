import type { AuthorizeDraftGenerationCommand } from '../intake/weeklyPlanningCommandTypes';
import type {
  PlanningDraftGenerationIntent,
  PlanningIntakeState,
} from '../intake/weeklyPlanningIntakeTypes';

export type DraftGenerationAuthorizationValidation =
  | { accepted: true; command: AuthorizeDraftGenerationCommand }
  | { accepted: false; reason: 'invalid-command' | 'unsupported-command' };

export function validateDraftGenerationAuthorizationCommand(
  candidate: unknown,
): DraftGenerationAuthorizationValidation {
  if (!candidate || typeof candidate !== 'object') {
    return { accepted: false, reason: 'invalid-command' };
  }

  const value = candidate as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const allowedKeys = ['confidence', 'sourceSegment', 'sourceText', 'type'];
  if (keys.some((key) => !allowedKeys.includes(key))) {
    return { accepted: false, reason: 'invalid-command' };
  }
  if (value.type !== 'authorize_draft_generation') {
    return { accepted: false, reason: 'unsupported-command' };
  }
  if (value.confidence !== 'high'
    || typeof value.sourceText !== 'string'
    || !value.sourceText.trim()
    || (value.sourceSegment !== undefined && typeof value.sourceSegment !== 'string')) {
    return { accepted: false, reason: 'invalid-command' };
  }

  return {
    accepted: true,
    command: value as unknown as AuthorizeDraftGenerationCommand,
  };
}

function resetDraftGenerationIntent(state: PlanningIntakeState): PlanningIntakeState {
  const draftGenerationIntent: PlanningDraftGenerationIntent = 'not_requested';
  return {
    ...state,
    draftGenerationIntent,
    draftGenerationAuthorizedAtRevision: undefined,
  };
}

export function reduceDraftGenerationAuthorization(
  state: PlanningIntakeState,
  validation: DraftGenerationAuthorizationValidation,
): PlanningIntakeState {
  if (!validation.accepted) return resetDraftGenerationIntent(state);

  const revision = state.sourceTurns.length;
  return {
    ...state,
    draftGenerationIntent: 'user_authorized',
    draftGenerationAuthorizedAtRevision: revision,
  };
}

/**
 * Applies an authorization signal that has already been selected by the semantic
 * layer. `userText` is retained only as command provenance; this function does
 * not inspect or classify its natural-language content.
 */
export function applyDraftGenerationAuthorizationTurn(params: {
  state: PlanningIntakeState;
  userText: string;
}): PlanningIntakeState {
  return reduceDraftGenerationAuthorization(
    params.state,
    validateDraftGenerationAuthorizationCommand({
      type: 'authorize_draft_generation',
      sourceText: params.userText,
      confidence: 'high',
    }),
  );
}
