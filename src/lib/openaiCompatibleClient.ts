import type { AiChatPurpose } from './aiModelPolicy';
import {
  createOpenAiCompatibleClient as createServiceOpenAiCompatibleClient,
} from '../services/ai/openAiCompatibleClient';
import type {
  ChatMessage,
  JsonSchemaResponseFormat,
  OpenAiCompatibleClientConfig,
} from '../services/ai/openAiCompatibleClient';

export type { JsonSchemaResponseFormat };

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
  return createServiceOpenAiCompatibleClient(config);
}
