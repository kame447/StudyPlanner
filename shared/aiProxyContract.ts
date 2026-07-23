export const AI_PROXY_CHAT_REQUEST_LIMITS = {
  maxRequestBodyBytes: 256 * 1024,
  maxMessageCount: 20,
  maxMessageContentLength: 96_000,
  maxTotalMessageContentLength: 160_000,
  defaultOutputTokens: 800,
  maxOutputTokens: 4_096,
} as const;

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function measureJsonUtf8Bytes(value: unknown): number {
  return getUtf8ByteLength(JSON.stringify(value));
}
