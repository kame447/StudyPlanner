import {
  getCloudflareAiProxyUrl,
  usesCloudflareOpenAiProxy,
} from '../../lib/aiConfig';
import type { AiChatPurpose } from '../../lib/aiModelPolicy';
import { getFirebaseAuth } from '../../lib/firebaseClient';
import { resolveOpenAiChatTemperature } from '../../../shared/aiProxyContract';
import {
  recordOpenAiCompatibleRequestMetric,
  utf8ByteLength,
} from './openAiCompatibleClientMetrics';

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
  temperature?: number;
  messages: ChatMessage[];
  response_format?: JsonSchemaResponseFormat;
  max_completion_tokens?: number;
}

interface ChatCompletionChoice {
  message?: {
    content?: string | null;
    refusal?: string | null;
  };
  finish_reason?: string | null;
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
    text_tokens?: number;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

interface AiProxyResponse {
  content?: string;
  error?: string;
  usage?: ChatCompletionUsage;
}

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 90_000;
const PROVIDER_ERROR_LABEL_MAX_CHARS = 120;
const PROVIDER_ERROR_MESSAGE_MAX_CHARS = 500;
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

function boundedProviderErrorField(
  value: unknown,
  maxChars: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars)}…`;
}

function diagnosticInteger(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : 'unknown';
}

function emptyDirectResponseMessage(data: ChatCompletionResponse): string {
  const choice = data.choices?.[0];
  const refusalPresent = Boolean(choice?.message?.refusal?.trim());
  return [
    'AI response was empty.',
    `finish_reason=${boundedProviderErrorField(choice?.finish_reason, PROVIDER_ERROR_LABEL_MAX_CHARS) ?? 'unknown'}`,
    `refusal=${refusalPresent ? 'present' : 'absent'}`,
    `completion_tokens=${diagnosticInteger(data.usage?.completion_tokens)}`,
    `reasoning_tokens=${diagnosticInteger(data.usage?.completion_tokens_details?.reasoning_tokens)}`,
  ].join(' ');
}

async function directProviderErrorMessage(response: Response): Promise<string> {
  const fallback = `AI request failed with status ${response.status}.`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text()) as unknown;
  } catch {
    return fallback;
  }
  if (!isRecord(parsed)) return fallback;
  const error = isRecord(parsed.error) ? parsed.error : parsed;
  const details = [
    ['type', boundedProviderErrorField(error.type, PROVIDER_ERROR_LABEL_MAX_CHARS)],
    ['code', boundedProviderErrorField(error.code, PROVIDER_ERROR_LABEL_MAX_CHARS)],
    ['param', boundedProviderErrorField(error.param, PROVIDER_ERROR_LABEL_MAX_CHARS)],
    ['message', boundedProviderErrorField(error.message, PROVIDER_ERROR_MESSAGE_MAX_CHARS)],
  ]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, value]) => `${key}=${value}`);
  return details.length > 0 ? `${fallback} ${details.join('; ')}` : fallback;
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

function shouldCaptureEvalMetrics(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_AI_EVAL_CAPTURE_METRICS?.trim() === '1'
    || env.VITE_AI_EVAL_CAPTURE_USAGE?.trim() === '1';
}

function requestPhase(
  purpose: AiChatPurpose | undefined,
  messages: ChatMessage[],
): 'initial' | 'repair' | 'single' {
  if (purpose !== 'weekly_planning_semantic_normalizer') return 'single';
  return isSemanticRepairRequest(purpose, messages) ? 'repair' : 'initial';
}

function recordRequestMetric(params: {
  purpose: AiChatPurpose | undefined;
  messages: ChatMessage[];
  model: string;
  transport: 'direct' | 'proxy';
  status: 'success' | 'failure';
  requestBody: string;
  responseContent?: string | null;
  usage?: ChatCompletionUsage | null;
  startedAtMs: number;
}): void {
  if (!shouldCaptureEvalMetrics()) return;
  recordOpenAiCompatibleRequestMetric({
    purpose: params.purpose ?? 'general',
    phase: requestPhase(params.purpose, params.messages),
    model: params.model,
    transport: params.transport,
    status: params.status,
    requestBytes: utf8ByteLength(params.requestBody),
    responseBytes: params.responseContent === undefined || params.responseContent === null
      ? null
      : utf8ByteLength(params.responseContent),
    promptTokens: params.usage?.prompt_tokens ?? null,
    completionTokens: params.usage?.completion_tokens ?? null,
    totalTokens: params.usage?.total_tokens ?? null,
    durationMs: Math.max(0, Date.now() - params.startedAtMs),
  });
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

        const proxyBody = {
          ...(purpose ? { purpose } : { model: config.model }),
          temperature,
          messages,
          response_format: responseFormat,
          ...(maxCompletionTokens === undefined
            ? {}
            : { max_completion_tokens: maxCompletionTokens }),
        };
        const requestBody = JSON.stringify(proxyBody);
        const logModel = purpose ? `purpose:${purpose}` : config.model;

        try {
          const endpoint = proxyUrl.endsWith('/chat/completions')
            ? proxyUrl
            : `${proxyUrl.replace(/\/$/, '')}/chat/completions`;
          claimProcessAiRequestBudget();
          const startedAtMs = Date.now();
          try {
            const result = await runFetchWithTimeout(
              endpoint,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`,
                },
                body: requestBody,
              },
              requestTimeoutMs,
              async (response) => (await response.json()) as AiProxyResponse,
            );
            const proxiedContent = result.content?.trim();

            if (!proxiedContent) {
              const responseMessage =
                result.error || 'AI proxy response did not include content.';
              console.error('[AI Proxy] response content missing', {
                proxyUrl: endpoint,
                responseMessage,
                model: logModel,
              });
              throw new Error(responseMessage);
            }

            recordRequestMetric({
              purpose,
              messages,
              model: logModel,
              transport: 'proxy',
              status: 'success',
              requestBody,
              responseContent: proxiedContent,
              usage: result.usage ?? null,
              startedAtMs,
            });
            return proxiedContent;
          } catch (error) {
            recordRequestMetric({
              purpose,
              messages,
              model: logModel,
              transport: 'proxy',
              status: 'failure',
              requestBody,
              startedAtMs,
            });
            throw error;
          }
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

      const semanticRepair = isSemanticRepairRequest(purpose, messages);
      const directModel = evalSemanticModel(purpose, messages) ?? config.model;
      const directTemperature = resolveOpenAiChatTemperature(directModel, temperature);
      const payload: ChatCompletionRequest = {
        model: directModel,
        ...(directTemperature === undefined ? {} : { temperature: directTemperature }),
        messages,
        response_format: responseFormat,
        ...(maxCompletionTokens === undefined
          ? {}
          : { max_completion_tokens: maxCompletionTokens }),
      };
      const requestBody = JSON.stringify(payload);
      claimProcessAiRequestBudget();
      const startedAtMs = Date.now();
      try {
        const result = await runFetchWithTimeout(
          `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: requestBody,
          },
          requestTimeoutMs,
          async (response) => {
            if (!response.ok) {
              throw new Error(await directProviderErrorMessage(response));
            }

            const data = (await response.json()) as ChatCompletionResponse;
            const content = data.choices?.[0]?.message?.content?.trim();

            if (!content) {
              throw new Error(emptyDirectResponseMessage(data));
            }

            return { content, usage: data.usage ?? null };
          },
        );

        if (shouldCaptureEvalUsage()) {
          console.info('[AI Eval Usage]', JSON.stringify({
            purpose: purpose ?? 'general',
            phase: purpose === 'weekly_planning_semantic_normalizer'
              ? (semanticRepair ? 'repair' : 'initial')
              : 'single',
            model: directModel,
            usage: result.usage,
          }));
        }
        recordRequestMetric({
          purpose,
          messages,
          model: directModel,
          transport: 'direct',
          status: 'success',
          requestBody,
          responseContent: result.content,
          usage: result.usage,
          startedAtMs,
        });
        return result.content;
      } catch (error) {
        recordRequestMetric({
          purpose,
          messages,
          model: directModel,
          transport: 'direct',
          status: 'failure',
          requestBody,
          startedAtMs,
        });
        throw error;
      }
    },
  };
}
