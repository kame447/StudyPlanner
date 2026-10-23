import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Unit 0's preregistered Jev 1.13 evaluation must not inherit later
// production-model upgrades. Only the isolated evaluation bundle uses this.
const productionPolicy = fileURLToPath(new URL('../workers/ai-proxy/src/decision/decisionPolicy.ts', import.meta.url));
const frozenPolicy = fileURLToPath(new URL('./fixtures/unit0-jev-1.13-decisionPolicy.ts', import.meta.url));
const frozenBlobSha = 'bb5ffa2740bfca6d844ddb756a2cee8557b98d10';

export const frozenJevPolicyPlugin = {
  name: 'preregistered-jev-decision-policy',
  setup(build) {
    build.onLoad({ filter: /decisionPolicy\.ts$/ }, async ({ path }) => {
      if (resolve(path) !== resolve(productionPolicy)) {
        throw new Error('Unexpected decision policy module in the preregistered evaluation.');
      }
      const source = await readFile(frozenPolicy, 'utf8');
      const blobSha = createHash('sha1')
        .update(`blob ${Buffer.byteLength(source)}\0`)
        .update(source)
        .digest('hex');
      if (blobSha !== frozenBlobSha) {
        throw new Error('Preregistered Jev 1.13 policy snapshot was modified.');
      }
      return { contents: source, loader: 'ts' };
    });
  },
};
