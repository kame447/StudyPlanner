// Public synthetic bytes only. This cache is separate from model/user indexes.
export const PROBE_CACHE = 'laplance-semantic-memory-cache-probe-v1';
export async function probeCache(label) {
  const result = { label, cacheStorageType: typeof caches, cacheConstructorType: typeof Cache,
    secureContext: isSecureContext, cases: [] };
  if (typeof caches === 'undefined') return result;
  try {
    const cache = await caches.open(PROBE_CACHE);
    const missing = await cache.match(new URL('/__cache_probe_missing', location.href).href);
    result.missingMatchType = missing === undefined ? 'undefined' : missing === null ? 'null' : typeof missing;
    const bytes = new TextEncoder().encode('synthetic-cache-probe');
    const cases = [
      ['buffer-local', new URL(`/__cache_probe_${label}_buffer`, location.href).href,
        () => new Response(bytes)],
      ['stream-local', new URL(`/__cache_probe_${label}_stream`, location.href).href,
        () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }))],
      ['buffer-public-key', 'https://huggingface.co/__synthetic_cache_probe/' + label,
        () => new Response(bytes)],
    ];
    for (const [name, key, response] of cases) {
      try {
        await cache.put(key, response());
        const stored = await cache.match(key);
        result.cases.push({ name, status: 'ok', matched: Boolean(stored), bytes: stored ? (await stored.arrayBuffer()).byteLength : null });
      } catch (error) { result.cases.push({ name, status: 'error', errorName: error.name, message: error.message }); }
    }
    // Fetch only one fixed public config, with no user text/credentials. Compare
    // native and reconstructed responses to isolate actual response metadata.
    const configUrl = 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/config.json';
    try {
      const response = await fetch(configUrl, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const buffer = await response.clone().arrayBuffer();
      result.publicConfig = { status: response.status, bytes: buffer.byteLength,
        headers: Object.fromEntries([...response.headers].filter(([key]) => ['content-type', 'content-length', 'content-encoding', 'vary', 'cache-control'].includes(key))) };
      const realCases = [
        ['real-config-native', () => response.clone()],
        ['real-config-copied-headers', () => new Response(buffer, { headers: response.headers })],
        ['real-config-clean-headers', () => new Response(buffer, { headers: { 'content-type': 'application/json', 'content-length': String(buffer.byteLength) } })],
      ];
      for (const [name, buildResponse] of realCases) {
        const key = configUrl + '?synthetic-cache-probe=' + label + '-' + name;
        try {
          await cache.put(key, buildResponse());
          const stored = await cache.match(key);
          result.cases.push({ name, status: 'ok', matched: Boolean(stored), bytes: stored ? (await stored.arrayBuffer()).byteLength : null });
        } catch (error) { result.cases.push({ name, status: 'error', errorName: error.name, message: error.message }); }
      }
    } catch (error) { result.publicConfigError = { name: error.name, message: error.message }; }
    result.keys = (await cache.keys()).map(request => new URL(request.url).pathname);
  } catch (error) { result.openError = { name: error.name, message: error.message }; }
  return result;
}

export async function probeStorageSizes() {
  const estimate = async () => {
    if (!navigator.storage?.estimate) return { supported: false };
    try { return { supported: true, ...await navigator.storage.estimate() }; }
    catch (error) { return { supported: true, errorName: error.name, message: error.message }; }
  };
  const result = { before: await estimate(), cases: [] };
  const namespace = PROBE_CACHE + '-sizes';
  // Independent entries, not cumulative: distinguish per-entry and origin limits.
  for (const mebibytes of [1, 50, 150]) {
    await caches.delete(namespace);
    const before = await estimate();
    const cache = await caches.open(namespace);
    const key = new URL(`/__cache_probe_size_${mebibytes}`, location.href).href;
    const block = new Uint8Array(1024 * 1024).fill(83);
    const started = performance.now();
    const record = { mebibytes, bytes: mebibytes * block.byteLength, before };
    try {
      await cache.put(key, new Response(new Blob(Array(mebibytes).fill(block)), {
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(record.bytes) },
      }));
      record.status = 'stored';
      record.immediateKeys = (await cache.keys()).length;
      const matched = await cache.match(key);
      record.matchContentLength = matched?.headers.get('content-length') ?? null;
      await matched?.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 200));
      record.reopenedKeys = (await (await caches.open(namespace)).keys()).length;
    } catch (error) { record.status = 'error'; record.errorName = error.name; record.message = error.message; }
    record.elapsedMs = performance.now() - started;
    record.after = await estimate();
    result.cases.push(record);
  }
  await caches.delete(namespace);
  result.afterCleanup = await estimate();
  return result;
}
