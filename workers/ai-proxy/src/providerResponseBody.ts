// The 4096-completion-token policy has a generous 256-byte/token sizing budget
// (1 MiB), doubled for JSON escaping/envelope/usage. This is a transport ceiling,
// not a claim about a tokenizer's mathematical maximum or a generation limit.
export const MAX_OPENAI_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function readBoundedOpenAiResponse(response: Response): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_OPENAI_RESPONSE_BYTES) {
        // Cancellation is best effort. Its upstream acknowledgement must not
        // keep an already rejected, oversized response on the critical path.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}
