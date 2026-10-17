import { AiProviderError, projectAiProviderFailure } from '../../../../shared/aiProviderFailure';
import { isCandidateChoiceDecisionContext, isCandidateChoiceEvaluation } from '../../../../shared/candidateChoiceDecision';
import type { ReplyReferenceChoiceCalibrationV5, ReplyReferenceChoicePortV5 } from '../../../../src/features/weeklyPlanning/semantic/weeklyPlanningReplyReferenceChoiceV5';
import type { OpenAiCompatibleClient } from '../../../../src/services/ai/openAiCompatibleClientTypes';
import { executeAuthenticatedChatRequest, type AiProxyWorkerEnv } from '../worker';
import { jevExecutionMode, lunaBaselineFailure } from '../decision/decisionExecutionMarker';
import type { DurableTurnExecute } from './durableTurnJob';
import { observeAiProxyRequest, type AiProxyRequestObserverEnv } from '../aiProxyRequestObserver';
import { isAiRequestObservabilityConfigured } from '../aiRequestObservability';

export function createDurableTurnProvider(
  env: AiProxyWorkerEnv,
  ownerId: string,
  dispatch: Parameters<DurableTurnExecute>[1],
  sourceIp = 'unknown',
  deadlineAt = Date.now() + 14 * 60_000,
): OpenAiCompatibleClient {
  return {
    async createChatCompletion(input) {
      const body = JSON.stringify({ messages: input.messages, purpose: input.purpose,
        temperature: input.temperature, response_format: input.responseFormat,
        max_completion_tokens: input.maxCompletionTokens, decisionContext: input.decisionContext });
      const raw = await dispatch(body, async () => {
        // No browser Request or bearer token crosses into the job. The accepted owner is fixed.
        const request = new Request('https://durable-turn.internal/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': sourceIp }, body,
          signal: AbortSignal.timeout(Math.max(1, Math.min(90_000, deadlineAt - Date.now()))),
        });
        const context = { identity: { kind: 'authenticated' as const, firebaseUid: ownerId } };
        const startedAtMs = Date.now();
        let response: Response;
        try {
          response = await executeAuthenticatedChatRequest(request, env, { uid: ownerId }, undefined, undefined, context);
        } catch (error) {
          if (error instanceof TypeError) {
            throw new AiProviderError('Durable AI transport failed.', { kind: 'network_error', httpStatus: 502 });
          }
          if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
            throw new AiProviderError('Durable AI transport was interrupted.', {
              kind: error.name === 'TimeoutError' ? 'timeout' : 'aborted', httpStatus: 502,
            });
          }
          throw error;
        }
        const observerEnv = env as unknown as AiProxyRequestObserverEnv;
        if (isAiRequestObservabilityConfigured(observerEnv)) {
          // Await the existing best-effort metric boundary inside the alarm lifetime.
          await observeAiProxyRequest({ request, response: response.clone(), context, env: observerEnv,
            startedAtMs, occurredAt: new Date(startedAtMs).toISOString(),
            decisionExecutionMode: jevExecutionMode(response), lunaBaselineFailure: lunaBaselineFailure(response),
          }).catch(() => undefined);
        }
        if (!response.ok) {
          const payload = await response.clone().json().catch(() => null) as { providerFailure?: unknown } | null;
          const detail = projectAiProviderFailure(payload?.providerFailure);
          throw new AiProviderError('Durable AI provider request failed.', {
            ...detail, kind: detail.kind === 'unknown' ? 'http_error' : detail.kind, httpStatus: response.status,
          });
        }
        return response.text();
      });
      const data = JSON.parse(raw) as { content?: string; decisionContext?: { requestId: string; inputRevision: number } };
      if (data.decisionContext && (data.decisionContext.requestId !== input.decisionContext?.requestId
        || data.decisionContext.inputRevision !== input.decisionContext?.inputRevision)) throw new AiProviderError('Decision response context mismatch.', { kind: 'context_mismatch' });
      if (!data.content?.trim()) throw new AiProviderError('Durable AI provider response was empty.', { kind: 'empty_response' });
      return data.content;
    },
  };
}


/**
 * Reuses the durable dispatch journal for Jev reference choices. A replay must
 * invoke the identical beforeDispatch gate even when the journal has a cached response.
 * The choice never writes graph state; Luna remains the value/meaning authority.
 */
export function createDurableReplyReferenceChoicePort(
  env: AiProxyWorkerEnv,
  ownerId: string,
  dispatch: Parameters<DurableTurnExecute>[1],
  semanticPolicy: ReplyReferenceChoiceCalibrationV5['semanticPolicy'],
  sourceIp = 'unknown',
  deadlineAt = Date.now() + 14 * 60_000,
): ReplyReferenceChoicePortV5 {
  return {
    async choose(request, beforeDispatch) {
      const context = { purpose: 'candidate_choice' as const, request };
      if (!isCandidateChoiceDecisionContext(context)) {
        throw new Error('Invalid durable reference candidate context.');
      }
      const body = JSON.stringify({
        purpose: 'weekly_planning_semantic_normalizer',
        messages: [{ role: 'user', content: request.wholeUtterance }],
        decisionContext: context,
      });
      // Immutable owner and captured candidate bytes; the durable journal owns resend/receipt.
      beforeDispatch();
      const raw = await dispatch(body, async () => {
        const proxyRequest = new Request('https://durable-turn.internal/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': sourceIp }, body,
          signal: AbortSignal.timeout(Math.max(1, Math.min(90_000, deadlineAt - Date.now()))),
        });
        const authContext = { identity: { kind: 'authenticated' as const, firebaseUid: ownerId } };
        const startedAtMs = Date.now();
        const response = await executeAuthenticatedChatRequest(
          proxyRequest, env, { uid: ownerId }, undefined, undefined, authContext);
        const observerEnv = env as unknown as AiProxyRequestObserverEnv;
        if (isAiRequestObservabilityConfigured(observerEnv)) {
          await observeAiProxyRequest({ request: proxyRequest, response: response.clone(),
            context: authContext, env: observerEnv, startedAtMs,
            occurredAt: new Date(startedAtMs).toISOString(),
            decisionExecutionMode: jevExecutionMode(response), lunaBaselineFailure: lunaBaselineFailure(response),
          }).catch(() => undefined);
        }
        if (!response.ok) throw new Error('Durable Jev reference choice unavailable.');
        return response.text();
      });
      const parsed: unknown = JSON.parse(raw);
      if (!isCandidateChoiceEvaluation(parsed, context.request)) {
        throw new Error('Invalid durable Jev reference choice result.');
      }
      return {
        nodeId: parsed.nodeId, requestId: parsed.requestId,
        selectionEpoch: parsed.selectionEpoch, candidateSetHash: parsed.candidateSetHash,
        optionId: parsed.optionId, probabilities: parsed.probabilities,
        semanticSufficiency: parsed.conditionChange <= semanticPolicy.maximumConditionChange
          && parsed.independentMeaning <= semanticPolicy.maximumIndependentMeaning
          ? 'only_candidate_meaning' as const : 'extra_or_uncertain_meaning' as const,
      };
    },
  };
}
