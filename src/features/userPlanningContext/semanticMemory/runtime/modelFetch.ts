import { SemanticMemoryUnavailableError } from '../semanticMemoryContract';
import { mapRuntimeError } from './protocol';
import { SEMANTIC_MEMORY_MODEL } from './model';

const MODEL_BASE = `https://huggingface.co/${SEMANTIC_MEMORY_MODEL.modelId}/resolve/${SEMANTIC_MEMORY_MODEL.revision}/`;
const MODEL_FILES = new Set(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_int8.onnx']);

/** A fixed public artifact allowlist: neither URLs nor bodies can contain input text. */
export function createPublicModelFetch(fetcher: typeof fetch, runtimeUrls: readonly string[] = []): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const file = url.startsWith(MODEL_BASE) ? url.slice(MODEL_BASE.length) : '';
    if ((!MODEL_FILES.has(file) && !runtimeUrls.includes(url)) || init?.body != null ||
        (init?.method !== undefined && init.method !== 'GET')) {
      throw new SemanticMemoryUnavailableError('model_download_failed');
    }
    let response: Response;
    try {
      // No inherited auth, custom headers, cookies, POSTs or user text.
      response = await fetcher(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch { throw new SemanticMemoryUnavailableError('model_download_failed'); }
    if (!response.ok) throw new SemanticMemoryUnavailableError('model_download_failed');
    const limit = file.endsWith('.onnx') ? SEMANTIC_MEMORY_MODEL.maxWeightBytes : 20_000_000;
    if (runtimeUrls.includes(url)) return response;
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new SemanticMemoryUnavailableError('model_download_failed');
    }
    if (!response.body) throw new SemanticMemoryUnavailableError('model_download_failed');
    let received = 0;
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { controller.close(); return; }
          received += next.value.byteLength;
          if (received > limit) {
            await reader.cancel();
            throw new SemanticMemoryUnavailableError('model_download_failed');
          }
          controller.enqueue(next.value);
        } catch (error) {
          controller.error(new SemanticMemoryUnavailableError(mapRuntimeError(error, 'download')));
        }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
