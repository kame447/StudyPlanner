import { SemanticMemoryUnavailableError } from '../semanticMemoryContract';
import { SEMANTIC_MEMORY_MODEL } from './model';

export const MODEL_CACHE_CHUNK_BYTES = 32 * 1024 * 1024;
const FORMAT = 'laplance-public-artifact-chunks-v1';
const FORMAT_HEADER = 'x-laplance-model-cache';
type CachePort = Pick<Cache, 'match' | 'put' | 'delete'>;
interface Manifest {
  format: typeof FORMAT;
  generation: string;
  chunkBytes: number;
  byteLength: number;
  headers: [string, string][];
}
const keyString = (key: RequestInfo | URL) => typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
function chunkKey(key: string, generation: string, index: number): string {
  const url = new URL(key);
  url.searchParams.set('__laplance_model_chunk', generation + ':' + index);
  return url.href;
}

/**
 * Public model/runtime artifacts only, in the existing model namespace. WebKit
 * can resolve a large put then lose its body; keep every physical entry <=32MiB.
 * A generation manifest is published last, so partial writes never become hits.
 */
export function createChunkedModelCache(cache: CachePort, options: {
  chunkBytes?: number;
  maxBytes?: number;
  createGeneration?: () => string;
} = {}): Pick<Cache, 'match' | 'put'> {
  const chunkBytes = options.chunkBytes ?? MODEL_CACHE_CHUNK_BYTES;
  const maxBytes = options.maxBytes ?? SEMANTIC_MEMORY_MODEL.maxWeightBytes;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > maxBytes) throw new Error('invalid public cache chunk budget');
  const generation = options.createGeneration ?? (() => crypto.randomUUID());
  function validManifest(value: unknown): value is Manifest {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<Manifest>;
    return item.format === FORMAT && typeof item.generation === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(item.generation) &&
      Number.isSafeInteger(item.chunkBytes) && item.chunkBytes! > 0 && item.chunkBytes! <= MODEL_CACHE_CHUNK_BYTES &&
      Number.isSafeInteger(item.byteLength) && item.byteLength! > 0 && item.byteLength! <= maxBytes &&
      Math.ceil(item.byteLength! / item.chunkBytes!) <= Math.ceil(maxBytes / chunkBytes) &&
      Array.isArray(item.headers) && item.headers.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string'));
  }
  return {
    async match(input, query) {
      const key = keyString(input);
      const stored = await cache.match(input, query);
      if (!stored || stored.headers.get(FORMAT_HEADER) !== FORMAT) return stored;
      let manifest: Manifest;
      try {
        const value: unknown = await stored.json();
        if (!validManifest(value)) return undefined;
        manifest = value;
      } catch { return undefined; }
      // Open all chunk responses before returning a hit. Missing/evicted chunks
      // are a disposable cache miss, allowing the normal download/lexical fallback.
      const count = Math.ceil(manifest.byteLength / manifest.chunkBytes);
      const chunks = await Promise.all(Array.from({ length: count }, (_, index) => cache.match(chunkKey(key, manifest.generation, index))));
      if (chunks.some((chunk, index) => !chunk?.body || Number(chunk.headers.get('content-length')) !==
          Math.min(manifest.chunkBytes, manifest.byteLength - index * manifest.chunkBytes))) return undefined;
      let index = 0;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let received = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            while (index < chunks.length) {
              reader ??= chunks[index]!.body!.getReader();
              const next = await reader.read();
              if (next.done) { reader.releaseLock(); reader = undefined; index++; continue; }
              received += next.value.byteLength;
              if (received > manifest.byteLength) throw new SemanticMemoryUnavailableError('storage_unavailable');
              controller.enqueue(next.value); return;
            }
            if (received !== manifest.byteLength) throw new SemanticMemoryUnavailableError('storage_unavailable');
            controller.close();
          } catch (error) { controller.error(error); }
        },
        async cancel(reason) {
          await reader?.cancel(reason);
          await Promise.all(chunks.slice(index + 1).map(chunk => chunk?.body?.cancel(reason)));
        },
      });
      const headers = new Headers(manifest.headers);
      headers.set('content-length', String(manifest.byteLength));
      return new Response(body, { status: 200, headers });
    },
    async put(input, response) {
      const key = keyString(input);
      const url = new URL(key);
      if (!['http:', 'https:'].includes(url.protocol) || response.status !== 200 || !response.body) {
        throw new SemanticMemoryUnavailableError('storage_unavailable');
      }
      const advertised = Number(response.headers.get('content-length'));
      if (advertised > maxBytes) throw new SemanticMemoryUnavailableError('storage_unavailable');
      const id = generation();
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error('invalid public cache generation');
      const written: string[] = [];
      const reader = response.body.getReader();
      let buffer = new Uint8Array(advertised > 0 ? Math.min(advertised, chunkBytes) : Math.min(64 * 1024, chunkBytes));
      let used = 0;
      let total = 0;
      let committed = false;
      const writeChunk = async () => {
        const chunk = chunkKey(key, id, written.length);
        // Record before put so failed partially persisted entries are cleaned too.
        written.push(chunk);
        await cache.put(chunk, new Response(buffer.subarray(0, used), {
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(used) },
        }));
        buffer = new Uint8Array(chunkBytes); used = 0;
      };
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > maxBytes) throw new SemanticMemoryUnavailableError('storage_unavailable');
          let offset = 0;
          while (offset < next.value.byteLength) {
            if (used === buffer.length && buffer.length < chunkBytes) {
              const grown = new Uint8Array(Math.min(chunkBytes, Math.max(buffer.length * 2, used + 1)));
              grown.set(buffer); buffer = grown;
            }
            const amount = Math.min(buffer.length - used, next.value.byteLength - offset);
            buffer.set(next.value.subarray(offset, offset + amount), used);
            used += amount; offset += amount;
            if (used === chunkBytes) await writeChunk();
          }
        }
        const headers = new Headers(response.headers);
        headers.set('content-length', String(total));
        if (!written.length) {
          await cache.put(key, new Response(buffer.subarray(0, used), { headers }));
        } else {
          if (used) await writeChunk();
          const manifest: Manifest = { format: FORMAT, generation: id, chunkBytes, byteLength: total, headers: [...headers] };
          // The original URL remains unchanged until every chunk write completes.
          await cache.put(key, new Response(JSON.stringify(manifest), {
            headers: { 'content-type': 'application/json', [FORMAT_HEADER]: FORMAT },
          }));
        }
        committed = true;
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        if (!committed) await Promise.all(written.map(chunk => cache.delete(chunk).catch(() => false)));
      }
    },
  };
}
