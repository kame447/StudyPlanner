import { describe, expect, it } from 'vitest';
import { createChunkedModelCache } from './chunkedModelCache';

class MemoryCache {
  readonly entries = new Map<string, Response>();
  readonly putKeys: string[] = [];
  failAt: string | undefined;
  async match(input: RequestInfo | URL) { return this.entries.get(String(input))?.clone(); }
  async put(input: RequestInfo | URL, response: Response) {
    const key = String(input); this.putKeys.push(key);
    if (this.failAt && key.includes(this.failAt)) throw new DOMException('synthetic quota failure', 'QuotaExceededError');
    // Native Cache API snapshots bodies before resolving.
    const data = await response.arrayBuffer();
    this.entries.set(key, new Response(data, { status: response.status, headers: response.headers }));
  }
  async delete(input: RequestInfo | URL) { return this.entries.delete(String(input)); }
}
const key = 'https://huggingface.co/public/resolve/pinned/model.onnx';
function fixture(generation = 'one') {
  const native = new MemoryCache();
  const cache = createChunkedModelCache(native, { chunkBytes: 16, maxBytes: 64, createGeneration: () => generation });
  return { native, cache };
}

describe('bounded public artifact Cache API adapter', () => {
  it('keeps small artifacts directly readable with correct headers', async () => {
    const { native, cache } = fixture();
    await cache.put(key, new Response('short', { headers: { 'content-type': 'test/plain', 'content-length': '5' } }));
    expect(native.entries.size).toBe(1);
    expect(await (await cache.match(key))?.text()).toBe('short');
    expect((await cache.match(key))?.headers.get('content-type')).toBe('test/plain');
  });
  it('splits large bodies within entry bounds, publishes manifest last and streams exact bytes', async () => {
    const { native, cache } = fixture();
    const data = Uint8Array.from({ length: 41 }, (_, index) => index);
    await cache.put(key, new Response(data, { headers: { 'content-type': 'application/octet-stream', 'content-length': '41' } }));
    expect(native.putKeys[native.putKeys.length - 1]).toBe(key);
    const chunks = [...native.entries].filter(([entry]) => entry !== key);
    expect(chunks).toHaveLength(3);
    for (const [, response] of chunks) expect((await response.clone().arrayBuffer()).byteLength).toBeLessThanOrEqual(16);
    const result = await cache.match(key);
    expect(result?.headers.get('content-length')).toBe('41');
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(data);
  });
  it('never exposes a partial generation; failed replacement preserves the old artifact and cleans new chunks', async () => {
    const { native, cache } = fixture();
    await cache.put(key, new Response('old'));
    native.failAt = '__laplance_model_chunk=one%3A1';
    await expect(cache.put(key, new Response(new Uint8Array(41)))).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await (await cache.match(key))?.text()).toBe('old');
    expect([...native.entries.keys()]).toEqual([key]);
  });
  it('readers cannot see a generation while its chunks are still being written', async () => {
    const { native, cache } = fixture();
    let release: () => void = () => {};
    let reached: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { reached = resolve; });
    const put = native.put.bind(native);
    native.put = async (input, response) => {
      await put(input, response);
      if (String(input).includes('__laplance_model_chunk=one%3A0')) { reached(); await held; }
    };
    const writing = cache.put(key, new Response(new Uint8Array(41).fill(7)));
    await started;
    expect(await cache.match(key)).toBeUndefined();
    release(); await writing;
    expect(new Uint8Array(await (await cache.match(key))!.arrayBuffer())).toEqual(new Uint8Array(41).fill(7));
  });
  it('treats evicted chunks or malformed manifests as misses, never partial model bytes', async () => {
    const { native, cache } = fixture();
    await cache.put(key, new Response(new Uint8Array(41)));
    const chunk = [...native.entries.keys()].find(entry => entry !== key)!;
    await native.delete(chunk);
    expect(await cache.match(key)).toBeUndefined();
    native.entries.set(key, new Response('{}', { headers: { 'x-laplance-model-cache': 'laplance-public-artifact-chunks-v1' } }));
    expect(await cache.match(key)).toBeUndefined();
  });
  it('handles multi-read streams and exact boundaries without unbounded buffering', async () => {
    const { native, cache } = fixture();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(10).fill(1)); controller.enqueue(new Uint8Array(22).fill(2)); controller.close();
    } });
    await cache.put(key, new Response(stream));
    expect(new Uint8Array(await (await cache.match(key))!.arrayBuffer())).toEqual(Uint8Array.from([...Array(10).fill(1), ...Array(22).fill(2)]));
    expect(native.putKeys.filter(entry => entry !== key)).toHaveLength(2);
  });
  it('enforces total body cap even with misleading size headers and rejects non-HTTP cache writes', async () => {
    const { native, cache } = fixture();
    await expect(cache.put(key, new Response(new Uint8Array(65), { headers: { 'content-length': '2' } }))).rejects.toMatchObject({ reason: 'storage_unavailable' });
    expect(native.entries.size).toBe(0);
    await expect(cache.put('data:text/plain,synthetic', new Response('x'))).rejects.toMatchObject({ reason: 'storage_unavailable' });
  });
  it('namespace erasure removes manifests/chunks together and leaves no logical hit', async () => {
    const { native, cache } = fixture();
    await cache.put(key, new Response(new Uint8Array(41)));
    native.entries.clear(); // CacheStorage.delete(namespace) destroys every entry.
    expect(await cache.match(key)).toBeUndefined();
  });
});
