import { getSupabaseClient } from '../../lib/supabaseClient';
import { getSupabaseConfig } from '../../lib/supabaseConfig';
import { usesSupabaseOpenAiProxy } from '../../lib/aiConfig';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiCompatibleClientConfig {
  provider?: 'ollama' | 'openai' | 'rules';
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

interface SupabaseProxyResponse {
  content?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function extractResponseErrorMessage(
  response: Response,
): Promise<string | undefined> {
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const parsed = (await response.clone().json()) as unknown;

      if (isRecord(parsed)) {
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error.trim();
        }

        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          return parsed.message.trim();
        }
      }
    }

    const text = (await response.clone().text()).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

function parseJwtMeta(token: string): Record<string, string | number | undefined> {
  try {
    const payload = token.split('.')[1];

    if (!payload) {
      return {};
    }

    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decodedPayload = atob(normalizedPayload);
    const parsed = JSON.parse(decodedPayload) as Record<string, unknown>;

    return {
      iss: typeof parsed.iss === 'string' ? parsed.iss : undefined,
      aud: typeof parsed.aud === 'string' ? parsed.aud : undefined,
      sub: typeof parsed.sub === 'string' ? parsed.sub : undefined,
      exp: typeof parsed.exp === 'number' ? parsed.exp : undefined,
      role: typeof parsed.role === 'string' ? parsed.role : undefined,
    };
  } catch {
    return {};
  }
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

      if (usesSupabaseOpenAiProxy({ provider: config.provider ?? 'openai' })) {
        const supabase = getSupabaseClient();
        const supabaseConfig = getSupabaseConfig();

        if (!supabase) {
          throw new Error('Supabase client is not available.');
        }

        if (!supabaseConfig.enabled) {
          throw new Error('Supabase configuration is not available.');
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        const accessToken = session?.access_token?.trim();

        if (!accessToken) {
          throw new Error(
            'Supabase のログインセッションが見つかりません。ログインし直してください。',
          );
        }

        const functionUrl = `${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/ai-planner`;
        const response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseConfig.anonKey,
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const responseMessage =
            (await extractResponseErrorMessage(response)) ??
            `AI proxy request failed with status ${response.status}.`;

          console.error('[AI Proxy] request failed', {
            functionUrl,
            status: response.status,
            statusText: response.statusText,
            responseMessage,
            tokenMeta: parseJwtMeta(accessToken),
            model: payload.model,
          });

          throw new Error(responseMessage);
        }

        const data = (await response.json()) as SupabaseProxyResponse;
        const proxiedContent = data?.content?.trim();

        if (!proxiedContent) {
          const responseMessage = data?.error || 'AI proxy response was empty.';

          console.error('[AI Proxy] response content missing', {
            functionUrl,
            responseMessage,
            tokenMeta: parseJwtMeta(accessToken),
            model: payload.model,
          });

          throw new Error(responseMessage);
        }

        return proxiedContent;
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
