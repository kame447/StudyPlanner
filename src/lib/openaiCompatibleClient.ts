import type { AiChatPurpose } from './aiModelPolicy';
import {
  createOpenAiCompatibleClient as createServiceOpenAiCompatibleClient,
} from '../services/ai/openAiCompatibleClient';
import type {
  ChatMessage,
  JsonSchemaResponseFormat as ServiceJsonSchemaResponseFormat,
  OpenAiCompatibleClientConfig,
} from '../services/ai/openAiCompatibleClient';

export interface FlatJsonSchemaResponseFormat {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export type JsonSchemaResponseFormat =
  | ServiceJsonSchemaResponseFormat
  | FlatJsonSchemaResponseFormat;

export interface OpenAiCompatibleClient {
  createChatCompletion(input: {
    messages: ChatMessage[];
    temperature?: number;
    responseFormat?: JsonSchemaResponseFormat;
    purpose?: AiChatPurpose;
  }): Promise<string>;
}

function normalizeResponseFormat(
  responseFormat: JsonSchemaResponseFormat | undefined,
): ServiceJsonSchemaResponseFormat | undefined {
  if (!responseFormat) {
    return undefined;
  }

  if ('json_schema' in responseFormat) {
    return responseFormat;
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: responseFormat.name,
      schema: responseFormat.schema,
      strict: responseFormat.strict,
    },
  };
}

export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleClientConfig,
): OpenAiCompatibleClient {
  const client = createServiceOpenAiCompatibleClient(config);

  return {
    createChatCompletion(input) {
      return client.createChatCompletion({
        ...input,
        responseFormat: normalizeResponseFormat(input.responseFormat),
      });
    },
  };
}
