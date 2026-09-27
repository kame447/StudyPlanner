import {
  createUserPlanningContextNaturalLanguageMessagesV2,
  parseUserPlanningContextNaturalLanguageResultV2,
  USER_PLANNING_CONTEXT_RESPONSE_FORMAT_V2,
  type UserPlanningContextNaturalLanguageResultV2,
} from '../../../../../src/features/userPlanningContext/userPlanningContextNaturalLanguageV2Contract';

export const USER_CONTEXT_ROUTING_LUNA_MODEL = 'gpt-5.6-luna' as const;
export const USER_CONTEXT_ROUTING_LUNA_MAX_COMPLETION_TOKENS = 700;

export interface UserContextRoutingLunaMetadata {
  requestedModel: string;
  servedModel: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export type UserContextRoutingLunaEvaluation = {
  status: 'evaluated';
  interpretation: UserPlanningContextNaturalLanguageResultV2;
  content: string;
  metadata: UserContextRoutingLunaMetadata;
} | {
  status: 'invalid';
  reason: 'invalid_json' | 'invalid_response';
  metadata: UserContextRoutingLunaMetadata;
} | {
  status: 'unavailable';
  reason: 'configuration' | 'timeout' | 'cancelled' | 'network' | 'http';
  httpStatus?: number;
  metadata: UserContextRoutingLunaMetadata;
};

export interface UserContextRoutingLunaEvaluator {
  evaluate(text: string, signal?: AbortSignal): Promise<UserContextRoutingLunaEvaluation>;
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

export function createUserContextRoutingLunaEvaluator(options: {
  apiKey?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): UserContextRoutingLunaEvaluator {
  const requestedModel = USER_CONTEXT_ROUTING_LUNA_MODEL;
  return {
    async evaluate(text, signal) {
      const startedAt = Date.now();
      let servedModel: string | null = null;
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      const metadata = (): UserContextRoutingLunaMetadata => ({
        requestedModel,
        servedModel,
        latencyMs: Math.max(0, Date.now() - startedAt),
        promptTokens,
        completionTokens,
      });
      const apiKey = options.apiKey?.trim();
      if (!apiKey) {
        return { status: 'unavailable', reason: 'configuration', metadata: metadata() };
      }

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
        const baseUrl = (options.baseUrl?.trim() || 'https://api.openai.com/v1')
          .replace(/\/$/, '');
        const response = await (options.fetch ?? fetch)(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: requestedModel,
            messages: createUserPlanningContextNaturalLanguageMessagesV2({ text }),
            response_format: USER_PLANNING_CONTEXT_RESPONSE_FORMAT_V2,
            max_completion_tokens: USER_CONTEXT_ROUTING_LUNA_MAX_COMPLETION_TOKENS,
          }),
        });
        if (!response.ok) {
          return {
            status: 'unavailable',
            reason: 'http',
            httpStatus: response.status,
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
        if (!content) {
          return { status: 'invalid', reason: 'invalid_response', metadata: metadata() };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(content) as unknown;
        } catch {
          return { status: 'invalid', reason: 'invalid_json', metadata: metadata() };
        }
        try {
          return {
            status: 'evaluated',
            interpretation: parseUserPlanningContextNaturalLanguageResultV2(parsed),
            content,
            metadata: metadata(),
          };
        } catch {
          return { status: 'invalid', reason: 'invalid_response', metadata: metadata() };
        }
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
