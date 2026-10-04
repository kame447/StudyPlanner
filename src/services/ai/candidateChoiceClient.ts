import { isCandidateChoiceDecisionContext, isCandidateChoiceEvaluation, type CandidateChoiceWireRequest } from '../../../shared/candidateChoiceDecision';
import { getCloudflareAiProxyUrl } from '../../lib/aiConfig';
import { getFirebaseAuth } from '../../lib/firebaseClient';

export interface CandidateSemanticGatePolicy {
  readonly calibrationEvidenceId: string;
  readonly maximumConditionChange: number;
  readonly maximumIndependentMeaning: number;
}
/** Structural match for A's invocation-local SemanticCensusRequestObserver; no runtime dependency. */
export interface CandidateChoiceCensusObserver {
  observe<T>(stage: 'focused', dispatch: (join: unknown) => Promise<T>): Promise<T>;
}
/** No implicit calibration or direct-provider fallback. Raw auxiliary scores remain unproven without a policy. */
export function createCandidateChoiceClient(options: {
  semanticPolicy: CandidateSemanticGatePolicy;
  proxyUrl?: string;
  getToken?: () => Promise<string>;
  transport?: typeof fetch;
  timeoutMs?: number;
  /** Optional privacy-scoped census metadata; proxy only, never provider context or trace. */
  semanticCensus?: unknown;
  /** Invocation-local A scope: allocates a unique request per node and tracks it with Luna fallback. */
  semanticCensusObserver?: CandidateChoiceCensusObserver;
  uninterpretedSpans?: CandidateChoiceWireRequest['uninterpretedSpans'];
}) {
  const policy = Object.freeze({ ...options.semanticPolicy });
  if (!policy.calibrationEvidenceId?.trim() || [policy.maximumConditionChange, policy.maximumIndependentMeaning]
    .some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error('Explicit semantic gate calibration required.');
  return {
    async choose(request: CandidateChoiceWireRequest, beforeDispatch: () => void): Promise<unknown> {
      // Detach mutable caller references before any await; exact bytes are also what gets validated.
      const semanticBody = JSON.stringify({ purpose: 'weekly_planning_semantic_normalizer', messages: [{ role: 'user', content: request.wholeUtterance }], decisionContext: { purpose: 'candidate_choice', request: { ...request, ...(options.uninterpretedSpans === undefined ? {} : { uninterpretedSpans: options.uninterpretedSpans }) } } });
      const captured = JSON.parse(semanticBody) as { decisionContext: { purpose: 'candidate_choice'; request: CandidateChoiceWireRequest } };
      if (!isCandidateChoiceDecisionContext(captured.decisionContext)) throw new Error('Invalid candidate envelope.');
      const execute = async (join: unknown): Promise<unknown> => {
        const body = join === undefined ? semanticBody : JSON.stringify({ ...JSON.parse(semanticBody), semanticCensus: join });
        const endpoint = options.proxyUrl ?? getCloudflareAiProxyUrl();
        if (!endpoint) throw new Error('Candidate Choice requires the authenticated Worker transport.');
        const token = await (options.getToken ? options.getToken() : getFirebaseAuth()?.currentUser?.getIdToken());
        if (!token) throw new Error('Authenticated candidate Choice session required.');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
        try {
          // Authentication and serialization have completed. No await between gate and actual dispatch.
          beforeDispatch();
          const response = await (options.transport ?? fetch)(endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, signal: controller.signal,
          });
          if (!response.ok) throw new Error('Candidate Choice Worker request failed.');
          const result: unknown = await response.json();
          const r = captured.decisionContext.request;
          if (!isCandidateChoiceEvaluation(result, r)) throw new Error('Unavailable or invalid candidate response.');
          return {
            nodeId: result.nodeId, requestId: result.requestId, selectionEpoch: result.selectionEpoch,
            candidateSetHash: result.candidateSetHash, optionId: result.optionId, probabilities: result.probabilities,
            semanticSufficiency: result.conditionChange <= policy.maximumConditionChange && result.independentMeaning <= policy.maximumIndependentMeaning
              ? 'only_candidate_meaning' : 'extra_or_uncertain_meaning',
        };
      } finally { clearTimeout(timer); }
      };
      return options.semanticCensusObserver ? options.semanticCensusObserver.observe('focused', execute) : execute(options.semanticCensus);
    },
  };
}
