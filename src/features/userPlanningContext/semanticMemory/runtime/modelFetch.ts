import { SemanticMemoryUnavailableError } from '../semanticMemoryContract';
import { mapRuntimeError } from './protocol';
import { SEMANTIC_MEMORY_MODEL } from './model';

const MODEL_BASE = `https://huggingface.co/${SEMANTIC_MEMORY_MODEL.modelId}/resolve/${SEMANTIC_MEMORY_MODEL.revision}/`;
const MODEL_FILES = new Set(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_int8.onnx']);

/** A fixed public artifact allowlist: neither URLs nor bodies can contain input text. */
export function createPublicModelFetch(fetcher: typeof fetch, runtimeUrls: readonly string[] = [], onPublicBytes?: (bytes: number) => void): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const file = url.startsWith(MODEL_BASE) ? url.slice(MODEL_BASE.length) : '';
    const isRuntime = runtimeUrls.includes(url);
    const isModelFile = Boolean(file) && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(file) &&
      !file.split('/').some(segment => segment === '.' || segment === '..');
    if ((!isModelFile && !isRuntime) || init?.body != null ||
        (init?.method !== undefined && init.method !== 'GET')) {
      throw new SemanticMemoryUnavailableError('model_download_failed');
    }
    // The library probes optional artifacts. Absent/non-approved model files
    // are local 404s, never network requests or fatal transport exceptions.
    if (!isRuntime && !MODEL_FILES.has(file)) return new Response(null, { status: 404 });
    const range = new Headers(init?.headers).get('range');
    if (range !== null && range !== 'bytes=0-0') throw new SemanticMemoryUnavailableError('model_download_failed');
    let response: Response;
    try {
      // No inherited auth, custom headers, cookies, POSTs or user text.
      response = await fetcher(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
        ...(range === null ? {} : { headers: { Range: 'bytes=0-0' }, cache: 'no-store' as const }),
      });
    } catch { throw new SemanticMemoryUnavailableError('model_download_failed'); }
    if (!response.ok) throw new SemanticMemoryUnavailableError('model_download_failed');
    const limit = file.endsWith('.onnx') ? SEMANTIC_MEMORY_MODEL.maxWeightBytes : 20_000_000;
    // A partial metadata response must describe the full artifact, otherwise a
    // one-byte content-length could conceal a weight beyond the model budget.
    if (response.status === 206) {
      const match = response.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/);
      if (range === null || !match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) > limit) {
        await response.body?.cancel();
        throw new SemanticMemoryUnavailableError('model_download_failed');
      }
    }
    if (isRuntime) return response;
    const bodyLimit = response.status === 206 ? 1 : limit;
    if (Number(response.headers.get('content-length')) > bodyLimit) {
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
          onPublicBytes?.(next.value.byteLength);
          if (received > bodyLimit) {
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
