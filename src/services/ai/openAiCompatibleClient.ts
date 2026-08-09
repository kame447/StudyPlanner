import {
  getCloudflareAiProxyUrl,
  usesCloudflareOpenAiProxy,
} from '../../lib/aiConfig';
import type { AiChatPurpose } from '../../lib/aiModelPolicy';
import { getFirebaseAuth } from '../../lib/firebaseClient';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiCompatibleClientConfig {
  provider?: 'openai' | 'rules';
  baseUrl: string;
  model: string;
  apiKey: string;
  requestTimeoutMs?: number;
}

export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

interface ChatCompletionRequest {
  model: string;
  temperature: number;
  messages: ChatMessage[];
  response_format?: JsonSchemaResponseFormat;
  max_completion_tokens?: number;
}

interface ChatCompletionChoice {
  message?: {
    content?: string | null;
  };
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

interface AiProxyResponse {
  content?: string;
  error?: string;
}

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 90_000;
let processAiRequestCount = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractUnknownErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (isRecord(error)) {
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }

    if (typeof error.details === 'string' && error.details.trim()) {
      return error.details.trim();
    }

    if (typeof error.error === 'string' && error.error.trim()) {
      return error.error.trim();
    }
  }

  return fallbackMessage;
}

function resolvedTimeoutMs(configured: number | undefined): number {
  return typeof configured === 'number'
    && Number.isFinite(configured)
    && configured > 0
    ? Math.floor(configured)
    : DEFAULT_AI_REQUEST_TIMEOUT_MS;
}

function configuredProcessRequestLimit(): number | null {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_AI_MAX_PROCESS_REQUESTS?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isSemanticRepairRequest(
  purpose: AiChatPurpose | undefined,
  messages: ChatMessage[],
): boolean {
  if (purpose !== 'weekly_planning_semantic_normalizer') return false;
  return messages.some((message) => message.role === 'assistant')
    && messages.some(
      (message) => message.role === 'user'
        && message.content.includes('"validationErrors"')
        && message.content.includes('"requiredChanges"'),
    );
}

function evalSemanticModel(
  purpose: AiChatPurpose | undefined,
  messages: ChatMessage[],
): string | null {
  if (purpose !== 'weekly_planning_semantic_normalizer') return null;
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_AI_EVAL_ENABLE_PURPOSE_MODEL_OVERRIDE?.trim() !== '1') return null;

  if (isSemanticRepairRequest(purpose, messages)) {
    const repairModel = env.VITE_AI_EVAL_SEMANTIC_REPAIR_MODEL?.trim();
    if (repairModel) return repairModel;
  }

  return env.VITE_AI_EVAL_SEMANTIC_MODEL?.trim() || null;
}

function shouldCaptureEvalUsage(): boolean {
  return (import.meta.env as Record<string, string | undefined>)
    .VITE_AI_EVAL_CAPTURE_USAGE?.trim() === '1';
}

function claimProcessAiRequestBudget(): void {
  const limit = configuredProcessRequestLimit();
  if (limit === null) return;
  if (processAiRequestCount >= limit) {
    throw new Error(`AI process request budget exceeded: ${limit}.`);
  }
  processAiRequestCount += 1;
}

export function resetOpenAiCompatibleClientRequestBudgetForTest(): void {
  processAiRequestCount = 0;
}

async function runFetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  handleResponse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await handleResponse(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`AI request timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface OpenAiCompatibleClient {
  createChatCompletion(input: {
    messages: ChatMessage[];
    temperature?: number;
    responseFormat?: JsonSchemaResponseFormat;
    purpose?: AiChatPurpose;
    maxCompletionTokens?: number;
  }): Promise<string>;
}

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleClientConfig,
): OpenAiCompatibleClient {
  const requestTimeoutMs = resolvedTimeoutMs(config.requestTimeoutMs);
  return {
    async createChatCompletion({
      messages,
      temperature = 0.2,
      responseFormat,
      purpose,
      maxCompletionTokens,
    }) {
      if (usesCloudflareOpenAiProxy({ provider: config.provider ?? 'openai' })) {
        const proxyUrl = getCloudflareAiProxyUrl();
        const firebaseAuth = getFirebaseAuth();

        if (!proxyUrl) {
          throw new Error('Cloudflare AI proxy URL is not configured.');
        }

        if (!firebaseAuth?.currentUser) {
          throw new Error('ログイン済みユーザーの Firebase セッションが見つかりません。');
        }

        const idToken = await firebaseAuth.currentUser.getIdToken();

        // 本番経路(Worker が single source of truth):
        // purpose がある呼び出しは model 名を送らず、Worker が purpose から model を解決する。
        // purpose 無しの既存呼び出し(general NL)は従来どおり config.model を送る。
        const proxyBody = {
          ...(purpose ? { purpose } : { model: config.model }),
          temperature,
          messages,
          response_format: responseFormat,
          ...(maxCompletionTokens === undefined
            ? {}
            : { max_completion_tokens: maxCompletionTokens }),
        };
        const logModel = purpose ? `purpose:${purpose}` : config.model;

        try {
          const endpoint = proxyUrl.endsWith('/chat/completions')
            ? proxyUrl
            : `${proxyUrl.replace(/\/$/, '')}/chat/completions`;
          claimProcessAiRequestBudget();
          return await runFetchWithTimeout(
            endpoint,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify(proxyBody),
            },
            requestTimeoutMs,
            async (response) => {
              const result = (await response.json()) as AiProxyResponse;
              const proxiedContent = result.content?.trim();

              if (!proxiedContent) {
                const responseMessage =
                  result.error || `AI proxy request failed with status ${response.status}.`;

                console.error('[AI Proxy] response content missing', {
                  proxyUrl: endpoint,
                  responseMessage,
                  model: logModel,
                });

                throw new Error(responseMessage);
              }

              return proxiedContent;
            },
          );
        } catch (error) {
          const responseMessage = extractUnknownErrorMessage(
            error,
            'AI proxy request failed.',
          );

          console.error('[AI Proxy] request failed', {
            proxyUrl,
            responseMessage,
            model: logModel,
          });

          throw new Error(responseMessage);
        }
      }

      // 直結(非 proxy / dev)経路では通常 config.model を使う。
      // 実API評価時だけ、明示的な opt-in env によりsemantic initial/repairを個別に差し替える。
      // renderer等はconfig.modelのままなので、repair戦略だけを比較できる。
      const semanticRepair = isSemanticRepairRequest(purpose, messages);
      const directModel = evalSemanticModel(purpose, messages) ?? config.model;
      const payload: ChatCompletionRequest = {
        model: directModel,
        temperature,
        messages,
        response_format: responseFormat,
        ...(maxCompletionTokens === undefined
          ? {}
          : { max_completion_tokens: maxCompletionTokens }),
      };
      claimProcessAiRequestBudget();
      return runFetchWithTimeout(
        `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          requestTimeoutMs,
          body: JSON.stringify(payload),
        },
        async (response) => {
          if (!response.ok) {
            throw new Error(`AI request failed with status ${response.status}.`);
          }

          const data = (await response.json()) as ChatCompletionResponse;
          const content = data.choices?.[0]?.message?.content?.trim();

          if (shouldCaptureEvalUsage()) {
            console.info('[AI Eval Usage]', JSON.stringify({
              purpose: purpose ?? 'general',
              phase: purpose === 'weekly_planning_semantic_normalizer'
                ? (semanticRepair ? 'repair' : 'initial')
                : 'single',
              model: directModel,
              usage: data.usage ?? null,
            }));
          }

          if (!content) {
            throw new Error('AI response was empty.');
          }

          return content;
        },
      );
    },
  };
}
