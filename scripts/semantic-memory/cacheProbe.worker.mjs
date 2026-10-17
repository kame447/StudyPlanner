import { probeCache, probeStorageSizes } from './cacheProbe.mjs';
self.onmessage = async event => {
  self.postMessage(event.data?.type === 'storage-sizes' ? await probeStorageSizes() : await probeCache('worker'));
};
