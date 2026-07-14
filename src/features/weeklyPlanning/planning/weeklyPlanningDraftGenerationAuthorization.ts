import type { AuthorizeDraftGenerationCommand } from '../intake/weeklyPlanningCommandTypes';
import type {
  PlanningDraftGenerationIntent,
  PlanningIntakeState,
} from '../intake/weeklyPlanningIntakeTypes';

export type DraftGenerationAuthorizationValidation =
  | { accepted: true; command: AuthorizeDraftGenerationCommand }
  | { accepted: false; reason: 'invalid-command' | 'unsupported-command' };

const EXPLICIT_DRAFT_AUTHORIZATION =
  /(?:仮(?:の)?予定|予定|計画)(?:を|で|も)?(?:組んで|作って|立てて|出して|生成して|お願い)|(?:仮で|この条件で)(?:予定を?)?(?:組んで|作って)|予定作成を?(?:始めて|お願い)/;
const VAGUE_STUDY_GOAL = /(?:やらないと|勉強しないと|進めないと|そろそろ(?:勉強|課題))/;

export function parseDraftGenerationAuthorizationCommand(
  userText: string,
): AuthorizeDraftGenerationCommand | null {
  const normalized = userText.trim();
  if (!normalized || VAGUE_STUDY_GOAL.test(normalized) || !EXPLICIT_DRAFT_AUTHORIZATION.test(normalized)) {
    return null;
  }

  return {
    type: 'authorize_draft_generation',
    sourceText: normalized,
    confidence: 'high',
  };
}

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

export function applyDraftGenerationAuthorizationTurn(params: {
  state: PlanningIntakeState;
  userText: string;
}): PlanningIntakeState {
  const candidate = parseDraftGenerationAuthorizationCommand(params.userText);
  const validation = validateDraftGenerationAuthorizationCommand(candidate);
  return reduceDraftGenerationAuthorization(params.state, validation);
}
