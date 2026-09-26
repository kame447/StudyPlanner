import type { DecisionProviderName, FocusedAuthorizationDecisionContext } from '../../../../shared/focusedAuthorizationDecision';

export type AuthorizationDecision = 'create_plan' | 'fallback';
export type DecisionFailure = 'configuration' | 'timeout' | 'cancelled' | 'network' | 'http' | 'invalid_response' | 'model_mismatch';

export interface DecisionMetadata {
  provider: DecisionProviderName;
  requestedModel: string;
  servedModel: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  requestBytes: number;
  responseBytes: number | null;
}

export type DecisionEvaluation = {
  status: 'evaluated';
  decision: AuthorizationDecision;
  confidence: number;
  probabilities: Record<AuthorizationDecision, number>;
  conditionChange: number;
  independentMeaning: number;
  metadata: DecisionMetadata;
} | {
  status: 'unavailable';
  reason: DecisionFailure;
  httpStatus?: number;
  metadata: DecisionMetadata;
};

// Additional transports implement this port; the application owns gates and rollout.
export interface DecisionProvider {
  evaluate(
    state: FocusedAuthorizationDecisionContext['state'],
    signal?: AbortSignal,
  ): Promise<DecisionEvaluation>;
}
