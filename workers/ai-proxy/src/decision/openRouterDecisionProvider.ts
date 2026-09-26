import type { DecisionEvaluation, DecisionMetadata, DecisionProvider } from './decisionProvider';
import { AUTHORIZATION_QUESTIONS, JEV_MODEL, JEV_TIMEOUT_MS } from './decisionPolicy';

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function tokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createOpenRouterDecisionProvider(options: {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): DecisionProvider {
  return {
    async evaluate(state, signal) {
      const started = Date.now();
      const body = JSON.stringify({ model: JEV_MODEL.request, state, questions: AUTHORIZATION_QUESTIONS });
      const metadata: DecisionMetadata = {
        provider: 'openrouter', requestedModel: JEV_MODEL.request, servedModel: null,
        latencyMs: 0, inputTokens: null, outputTokens: null, costUsd: null,
        requestBytes: new TextEncoder().encode(body).length, responseBytes: null,
      };
      const failed = (reason: Extract<DecisionEvaluation, { status: 'unavailable' }>['reason'], httpStatus?: number): DecisionEvaluation => ({
        status: 'unavailable', reason, ...(httpStatus === undefined ? {} : { httpStatus }),
        metadata: { ...metadata, latencyMs: Date.now() - started },
      });
      if (!options.apiKey?.trim()) return failed('configuration');
      if (signal?.aborted) return failed('cancelled');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, options.timeoutMs ?? JEV_TIMEOUT_MS);
      try {
        const response = await (options.fetch ?? fetch)(DECISIONS_URL, {
          // Manual mode also works in the deployed Workers compatibility date; reject 3xx below.
          method: 'POST', redirect: 'manual', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey.trim()}` },
          body,
        });
        if (!response.ok) return failed('http', response.status);
        const text = await response.text();
        metadata.responseBytes = new TextEncoder().encode(text).length;
        if (metadata.responseBytes > 32_768) return failed('invalid_response');
        let root: Record<string, unknown> | null;
        try { root = record(JSON.parse(text)); } catch { return failed('invalid_response'); }
        const usage = record(root?.usage);
        metadata.inputTokens = tokens(usage?.input_tokens);
        metadata.outputTokens = tokens(usage?.output_tokens);
        metadata.costUsd = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0
          && Number.isSafeInteger(Math.round(usage.cost * 1_000_000))
          ? usage.cost : null;
        if (typeof root?.model !== 'string' || !JEV_MODEL.responses.includes(root.model)) {
          return failed('model_mismatch');
        }
        metadata.servedModel = root.model;
        const answers = record(root.answers);
        const auth = record(answers?.authorization);
        const distribution = record(auth?.probabilities);
        const changes = record(answers?.condition_change);
        const independent = record(answers?.independent_meaning);
        if (auth?.type !== 'choice'
          || (auth.choice !== 'create_plan' && auth.choice !== 'fallback')
          || !probability(auth.confidence)
          || !distribution || Object.keys(distribution).length !== 2
          || !probability(distribution.create_plan) || !probability(distribution.fallback)
          || Math.abs(distribution.create_plan + distribution.fallback - 1) > 0.02
          || (auth.choice === 'create_plan'
            ? distribution.create_plan < distribution.fallback
            : distribution.fallback < distribution.create_plan)
          || changes?.type !== 'noul' || !probability(changes.noul)
          || independent?.type !== 'noul' || !probability(independent.noul)
        ) return failed('invalid_response');
        if (controller.signal.aborted) return failed(signal?.aborted ? 'cancelled' : 'timeout');
        return {
          status: 'evaluated', decision: auth.choice, confidence: auth.confidence,
          probabilities: { create_plan: distribution.create_plan, fallback: distribution.fallback },
          conditionChange: changes.noul, independentMeaning: independent.noul,
          metadata: { ...metadata, latencyMs: Date.now() - started },
        };
      } catch {
        return failed(signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'network');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
