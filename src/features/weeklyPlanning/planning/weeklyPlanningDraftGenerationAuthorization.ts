import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { DraftGenerationIntent } from './weeklyPlanningBehaviorTypes';

declare module '../intake/weeklyPlanningIntakeTypes' {
  interface PlanningIntakeState {
    draftGenerationIntent?: DraftGenerationIntent;
    draftGenerationAuthorizedAtRevision?: number;
  }
}

export interface AuthorizeDraftGenerationCommand {
  type: 'authorize_draft_generation';
  sourceText: string;
  confidence: 'high';
}

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
  if (keys.join('|') !== ['confidence', 'sourceText', 'type'].sort().join('|')) {
    return { accepted: false, reason: 'invalid-command' };
  }
  if (value.type !== 'authorize_draft_generation') {
    return { accepted: false, reason: 'unsupported-command' };
  }
  if (value.confidence !== 'high' || typeof value.sourceText !== 'string' || !value.sourceText.trim()) {
    return { accepted: false, reason: 'invalid-command' };
  }

  return {
    accepted: true,
    command: value as unknown as AuthorizeDraftGenerationCommand,
  };
}

export function reduceDraftGenerationAuthorization(
  state: PlanningIntakeState,
  validation: DraftGenerationAuthorizationValidation,
): PlanningIntakeState {
  if (!validation.accepted) {
    return {
      ...state,
      draftGenerationIntent: 'not_requested',
      draftGenerationAuthorizedAtRevision: undefined,
    };
  }

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
