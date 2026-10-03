import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(new URL('../../package.json', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('temporary Firestore gRPC security bridge', () => {
  it('limits the patched transport override to the reviewed Firestore version', () => {
    expect(manifest.overrides['@firebase/firestore@4.14.0']).toEqual({ '@grpc/grpc-js': '1.13.6' });
    expect(manifest.overrides['@firebase/firestore']).toBeUndefined();
  });

  it('resolves the patched installed transport from the real Node SDK location', () => {
    const firestoreRequire = createRequire(require.resolve('@firebase/firestore'));
    expect(firestoreRequire('@grpc/grpc-js/package.json').version).toBe('1.13.6');
  });
});
