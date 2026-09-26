import { describe, expect, it } from 'vitest';
import {
  userContextRoutingPolicyFingerprints,
} from './userContextRoutingPolicyFingerprint';

describe('user-context routing policy fingerprints', () => {
  it('fingerprints the sealed catalog, gate and complete corpus', async () => {
    const fingerprints = await userContextRoutingPolicyFingerprints();
    expect(fingerprints).toEqual({
      catalogSha256: 'c3a284e53846d229f1932cae34acf00efc98f266986100ba4efed60aac0bdc4e',
      gateSha256: '9bcb1fc70281dc2420cce5ad18b0254716b45a52fbdd0bfd90ca9e9b28c90854',
      corpusSha256: '0a1a19be935a77dd9a4bda19f8a30e453dc00c4c1c77e637b56e8d9ae64510e6',
    });
  });
});
