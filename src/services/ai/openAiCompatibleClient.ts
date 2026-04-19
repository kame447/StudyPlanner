import {
  getCloudflareAiProxyUrl,
  usesCloudflareOpenAiProxy,
} from '../../lib/aiConfig';
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
}

interface ChatCompletionChoice {
  message?: {
    content?: string | null;
  };
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

interface AiProxyResponse {
  content?: string;
  error?: string;
}

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

export interface OpenAiCompatibleClient {
  createChatCompletion(input: {
    messages: ChatMessage[];
    temperature?: number;
    responseFormat?: JsonSchemaResponseFormat;
  }): Promise<string>;
}

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleClientConfig,
): OpenAiCompatibleClient {
  return {
    async createChatCompletion({
      messages,
      temperature = 0.2,
      responseFormat,
    }) {
      const payload: ChatCompletionRequest = {
        model: config.model,
        temperature,
        messages,
        response_format: responseFormat,
      };

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

        try {
          const endpoint = proxyUrl.endsWith('/chat/completions')
            ? proxyUrl
            : `${proxyUrl.replace(/\/$/, '')}/chat/completions`;
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify(payload),
          });
          const result = (await response.json()) as AiProxyResponse;
          const proxiedContent = result.content?.trim();

          if (!proxiedContent) {
            const responseMessage =
              result.error || `AI proxy request failed with status ${response.status}.`;

            console.error('[AI Proxy] response content missing', {
              proxyUrl: endpoint,
              responseMessage,
              model: payload.model,
            });

            throw new Error(responseMessage);
          }

          return proxiedContent;
        } catch (error) {
          const responseMessage = extractUnknownErrorMessage(
            error,
            'AI proxy request failed.',
          );

          console.error('[AI Proxy] request failed', {
            proxyUrl,
            responseMessage,
            model: payload.model,
          });

          throw new Error(responseMessage);
        }
      }

      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`AI request failed with status ${response.status}.`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new Error('AI response was empty.');
      }

      return content;
    },
  };
}
