export const AI_PROXY_CHAT_REQUEST_LIMITS = {
  maxRequestBodyBytes: 256 * 1024,
  maxMessageCount: 20,
  maxMessageContentLength: 96_000,
  maxTotalMessageContentLength: 160_000,
  defaultOutputTokens: 800,
  maxOutputTokens: 4_096,
} as const;

const DEFAULT_TEMPERATURE_ONLY_OPENAI_MODELS = new Set([
  'gpt-5.6-luna',
]);

export function resolveOpenAiChatTemperature(
  model: string,
  requestedTemperature: number,
): number | undefined {
  return DEFAULT_TEMPERATURE_ONLY_OPENAI_MODELS.has(model.trim())
    ? undefined
    : requestedTemperature;
}

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function measureJsonUtf8Bytes(value: unknown): number {
  return getUtf8ByteLength(JSON.stringify(value));
}

const CHAT_COMPLETION_FINISH_REASONS = [
  'stop', 'length', 'content_filter', 'tool_calls', 'function_call',
] as const;

/** Observation only. Unknown provider facts stay null and never control acceptance. */
export interface ProviderCompletionMetadata {
  finishReason: typeof CHAT_COMPLETION_FINISH_REASONS[number] | null;
  refusalPresent: boolean | null;
  requestedMaxCompletionTokens: number | null;
  effectiveMaxCompletionTokens: number | null;
  reasoningTokens: number | null;
  textTokens: number | null;
}

function completionRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function completionInteger(value: unknown, minimum: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value : null;
}

function completionFinishReason(value: unknown): ProviderCompletionMetadata['finishReason'] {
  return typeof value === 'string'
    && (CHAT_COMPLETION_FINISH_REASONS as readonly string[]).includes(value)
    ? value as NonNullable<ProviderCompletionMetadata['finishReason']> : null;
}

/** Project only bounded values; never retain provider text, arbitrary enums or headers. */
export function projectOpenAiCompletionMetadata(input: {
  response?: unknown;
  requestedMaxCompletionTokens?: unknown;
  effectiveMaxCompletionTokens?: unknown;
}): ProviderCompletionMetadata {
  const root = completionRecord(input.response);
  const choices = root?.choices;
  const choice = Array.isArray(choices) ? completionRecord(choices[0]) : null;
  const message = completionRecord(choice?.message);
  const usage = completionRecord(root?.usage);
  const details = completionRecord(usage?.completion_tokens_details);
  return {
    finishReason: completionFinishReason(choice?.finish_reason),
    refusalPresent: typeof message?.refusal === 'string'
      ? message.refusal.trim().length > 0 : message?.refusal === null ? false : null,
    requestedMaxCompletionTokens: completionInteger(input.requestedMaxCompletionTokens, 1),
    effectiveMaxCompletionTokens: completionInteger(input.effectiveMaxCompletionTokens, 1),
    reasoningTokens: completionInteger(details?.reasoning_tokens, 0),
    textTokens: completionInteger(details?.text_tokens, 0),
  };
}

/** Persisted metadata is a closed contract, including for server-side callers. */
export function isProviderCompletionMetadata(value: unknown): value is ProviderCompletionMetadata {
  const record = completionRecord(value);
  const keys = ['finishReason', 'refusalPresent', 'requestedMaxCompletionTokens',
    'effectiveMaxCompletionTokens', 'reasoningTokens', 'textTokens'];
  if (!record || Object.keys(record).length !== keys.length
    || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) return false;
  return (record.finishReason === null || completionFinishReason(record.finishReason) !== null)
    && (record.refusalPresent === null || typeof record.refusalPresent === 'boolean')
    && ['requestedMaxCompletionTokens', 'effectiveMaxCompletionTokens'].every((key) =>
      record[key] === null || completionInteger(record[key], 1) !== null)
    && ['reasoningTokens', 'textTokens'].every((key) =>
      record[key] === null || completionInteger(record[key], 0) !== null);
}
