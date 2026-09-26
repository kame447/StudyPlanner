import type { FocusedAuthorizationDecisionContext } from '../../../../shared/focusedAuthorizationDecision';
import type {
  AuthorizationDecision,
  DecisionEvaluation,
  DecisionMetadata,
  DecisionProvider,
  DecisionQuestionCatalog,
} from './decisionProvider';
import { AUTHORIZATION_QUESTIONS, JEV_MODEL, JEV_TIMEOUT_MS } from './decisionPolicy';

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const MAX_DECISIONS_RESPONSE_BYTES = 32_768;

type BoundedBody = {
  text: string | null;
  byteLength: number;
};

async function readBoundedBody(response: Response, abort: () => void): Promise<BoundedBody> {
  if (!response.body) return { text: '', byteLength: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_DECISIONS_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best-effort upstream cancellation */ }
        abort();
        return { text: null, byteLength };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), byteLength };
}

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
}): DecisionProvider;
export function createOpenRouterDecisionProvider<TState, TDecision extends string>(options: {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  catalog: DecisionQuestionCatalog<TDecision>;
}): DecisionProvider<TState, TDecision>;
export function createOpenRouterDecisionProvider<TState, TDecision extends string>(options: {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  catalog?: DecisionQuestionCatalog<TDecision>;
}): DecisionProvider<TState, TDecision> {
  const defaultCatalog: DecisionQuestionCatalog<AuthorizationDecision> = {
    questions: AUTHORIZATION_QUESTIONS,
    choiceAnswerKey: 'authorization',
    decisions: ['create_plan', 'fallback'],
    conditionChangeAnswerKey: 'condition_change',
    independentMeaningAnswerKey: 'independent_meaning',
  };
  const catalog = options.catalog
    ?? defaultCatalog as unknown as DecisionQuestionCatalog<TDecision>;
  return {
    async evaluate(state, signal) {
      const started = Date.now();
      const body = JSON.stringify({ model: JEV_MODEL.request, state, questions: catalog.questions });
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
        const responseBody = await readBoundedBody(response, () => controller.abort());
        metadata.responseBytes = responseBody.byteLength;
        if (responseBody.text === null) return failed('invalid_response');
        const text = responseBody.text;
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
        const choiceAnswer = record(answers?.[catalog.choiceAnswerKey]);
        const distribution = record(choiceAnswer?.probabilities);
        const changes = record(answers?.[catalog.conditionChangeAnswerKey]);
        const independent = record(answers?.[catalog.independentMeaningAnswerKey]);
        const choice = choiceAnswer?.choice;
        const distributionKeys = distribution ? Object.keys(distribution) : [];
        const probabilities = Object.fromEntries(catalog.decisions.map((decision) => [
          decision,
          distribution?.[decision],
        ])) as Record<TDecision, unknown>;
        const selectedProbability = typeof choice === 'string'
          ? probabilities[choice as TDecision]
          : undefined;
        if (choiceAnswer?.type !== 'choice'
          || typeof choice !== 'string'
          || !catalog.decisions.includes(choice as TDecision)
          || !probability(choiceAnswer.confidence)
          || !distribution
          || distributionKeys.length !== catalog.decisions.length
          || distributionKeys.some((key) => !catalog.decisions.includes(key as TDecision))
          || catalog.decisions.some((decision) => !probability(probabilities[decision]))
          || Math.abs(catalog.decisions.reduce(
            (sum, decision) => sum + Number(probabilities[decision]),
            0,
          ) - 1) > 0.02
          || !probability(selectedProbability)
          || catalog.decisions.some((decision) =>
            Number(probabilities[decision]) > selectedProbability)
          || changes?.type !== 'noul' || !probability(changes.noul)
          || independent?.type !== 'noul' || !probability(independent.noul)
        ) return failed('invalid_response');
        if (controller.signal.aborted) return failed(signal?.aborted ? 'cancelled' : 'timeout');
        return {
          status: 'evaluated', decision: choice as TDecision, confidence: choiceAnswer.confidence,
          probabilities: probabilities as Record<TDecision, number>,
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
