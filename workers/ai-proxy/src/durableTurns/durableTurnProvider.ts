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
        const response = await executeAuthenticatedChatRequest(request, env, { uid: ownerId }, undefined, undefined, context);
        const observerEnv = env as unknown as AiProxyRequestObserverEnv;
        if (isAiRequestObservabilityConfigured(observerEnv)) {
          // Await the existing best-effort metric boundary inside the alarm lifetime.
          await observeAiProxyRequest({ request, response: response.clone(), context, env: observerEnv,
            startedAtMs, occurredAt: new Date(startedAtMs).toISOString(),
            decisionExecutionMode: jevExecutionMode(response), lunaBaselineFailure: lunaBaselineFailure(response),
          }).catch(() => undefined);
        }
        if (!response.ok) throw new Error('Durable AI provider request failed.');
        return response.text();
      });
      const data = JSON.parse(raw) as { content?: string; decisionContext?: { requestId: string; inputRevision: number } };
      if (data.decisionContext && (data.decisionContext.requestId !== input.decisionContext?.requestId
        || data.decisionContext.inputRevision !== input.decisionContext?.inputRevision)) throw new Error('Decision response context mismatch.');
      if (!data.content?.trim()) throw new Error('Durable AI provider response was empty.');
      return data.content;
    },
  };
}
