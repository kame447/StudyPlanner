// Provider-neutral, bounded context. Never an approval/save authorization.
export type DecisionProviderName = 'openrouter' | 'typesafe' | 'cloudflare';

export interface FocusedAuthorizationDecisionContext {
  purpose: 'focused_authorization';
  requestId: string;
  inputRevision: number;
  previousStatus: 'needs_scope';
  hasTasks: true;
  hasPendingQuestion: false;
  state: {
    currentUserText: string;
    lastAssistantMessage: string | null;
  };
}

export function isFocusedAuthorizationDecisionContext(
  value: unknown,
): value is FocusedAuthorizationDecisionContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const state = v.state as Record<string, unknown> | null;
  return v.purpose === 'focused_authorization'
    && typeof v.requestId === 'string' && v.requestId.length > 0 && v.requestId.length <= 160
    && typeof v.inputRevision === 'number' && Number.isSafeInteger(v.inputRevision) && v.inputRevision >= 0
    && v.previousStatus === 'needs_scope' && v.hasTasks === true && v.hasPendingQuestion === false
    && typeof state === 'object' && state !== null && !Array.isArray(state)
    && Object.keys(v).every((key) => ['purpose', 'requestId', 'inputRevision', 'previousStatus', 'hasTasks', 'hasPendingQuestion', 'state'].includes(key))
    && Object.keys(state).every((key) => ['currentUserText', 'lastAssistantMessage'].includes(key))
    && typeof state.currentUserText === 'string' && state.currentUserText.trim().length > 0
    && new TextEncoder().encode(state.currentUserText).length <= 8_000
    && (state.lastAssistantMessage === null
      || (typeof state.lastAssistantMessage === 'string'
        && new TextEncoder().encode(state.lastAssistantMessage).length <= 4_000));
}
