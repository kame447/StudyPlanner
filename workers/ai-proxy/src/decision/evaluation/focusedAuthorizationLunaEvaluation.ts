import type { FocusedAuthorizationDecisionContext } from '../../../../../shared/focusedAuthorizationDecision';
import {
  FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
  FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
  createFocusedAuthorizationMessagesV5,
  parseFocusedAuthorizationDecisionV5,
} from '../../../../../src/features/weeklyPlanning/semantic/weeklyPlanningFocusedAuthorizationV5';
import type { AuthorizationDecision } from '../decisionProvider';

export const LUNA_FOCUSED_AUTHORIZATION_MODEL = 'gpt-5.6-luna' as const;

export type FocusedAuthorizationEvaluationContext =
  FocusedAuthorizationDecisionContext['state'];

export interface LunaTokenPricing {
  promptUsdPerMillion: number;
  completionUsdPerMillion: number;
}

export type LunaPricingTable = Readonly<Record<string, LunaTokenPricing>>;

export interface LunaEvaluationMetadata {
  requestedModel: string;
  servedModel: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
}

export type LunaFocusedAuthorizationEvaluation = {
  status: 'evaluated';
  decision: AuthorizationDecision;
  metadata: LunaEvaluationMetadata;
} | {
  status: 'invalid';
  reason: 'invalid_json' | 'invalid_response';
  metadata: LunaEvaluationMetadata;
} | {
  status: 'unavailable';
  reason: 'configuration' | 'timeout' | 'cancelled' | 'network' | 'http';
  httpStatus?: number;
  metadata: LunaEvaluationMetadata;
};

export interface LunaFocusedAuthorizationEvaluator {
  evaluate(
    context: FocusedAuthorizationEvaluationContext,
    signal?: AbortSignal,
  ): Promise<LunaFocusedAuthorizationEvaluation>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function validPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function costForUsage(
  pricing: LunaPricingTable | undefined,
  model: string,
  promptTokens: number | null,
  completionTokens: number | null,
): number | null {
  if (!pricing || promptTokens === null || completionTokens === null) return null;
  const price = pricing[model];
  if (!price
    || !validPrice(price.promptUsdPerMillion)
    || !validPrice(price.completionUsdPerMillion)) return null;
  return (promptTokens * price.promptUsdPerMillion
    + completionTokens * price.completionUsdPerMillion) / 1_000_000;
}

export function createLunaFocusedAuthorizationEvaluator(options: {
  apiKey?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  pricing?: LunaPricingTable;
}): LunaFocusedAuthorizationEvaluator {
  const requestedModel = LUNA_FOCUSED_AUTHORIZATION_MODEL;
  return {
    async evaluate(context, signal) {
      const startedAt = Date.now();
      let servedModel: string | null = null;
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      const metadata = (): LunaEvaluationMetadata => ({
        requestedModel,
        servedModel,
        latencyMs: Math.max(0, Date.now() - startedAt),
        promptTokens,
        completionTokens,
        costUsd: costForUsage(
          options.pricing,
          servedModel ?? requestedModel,
          promptTokens,
          completionTokens,
        ),
      });
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        return { status: 'unavailable', reason: 'configuration', metadata: metadata() };
      }

      const messages = createFocusedAuthorizationMessagesV5({
        userText: context.currentUserText,
        publicStateSummary: { lastAssistantMessage: context.lastAssistantMessage },
      });
      const controller = new AbortController();
      let cancelled = false;
      let timedOut = false;
      const cancel = () => {
        cancelled = true;
        controller.abort();
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs ?? 90_000);
      try {
        const baseUrl = (options.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: requestedModel,
            messages,
            response_format: FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
            max_completion_tokens: FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
          }),
        });
        if (!response.ok) {
          return {
            status: 'unavailable', reason: 'http', httpStatus: response.status,
            metadata: metadata(),
          };
        }

        let root: Record<string, unknown> | null;
        try {
          root = record(await response.json());
        } catch {
          return { status: 'invalid', reason: 'invalid_json', metadata: metadata() };
        }
        servedModel = typeof root?.model === 'string' && root.model.trim()
          ? root.model
          : null;
        const usage = record(root?.usage);
        promptTokens = tokenCount(usage?.prompt_tokens);
        completionTokens = tokenCount(usage?.completion_tokens);
        const choices = Array.isArray(root?.choices) ? root.choices : [];
        const firstChoice = record(choices[0]);
        const message = record(firstChoice?.message);
        const content = typeof message?.content === 'string' ? message.content.trim() : '';
        const parsed = content ? parseFocusedAuthorizationDecisionV5(content) : null;
        if (!parsed) {
          return { status: 'invalid', reason: 'invalid_response', metadata: metadata() };
        }
        return { status: 'evaluated', decision: parsed.decision, metadata: metadata() };
      } catch {
        return {
          status: 'unavailable',
          reason: cancelled ? 'cancelled' : timedOut ? 'timeout' : 'network',
          metadata: metadata(),
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
