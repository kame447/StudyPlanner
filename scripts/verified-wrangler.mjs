import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Supported toolchain policy, not evidence of a fresh live-provider evaluation.
export const PINNED_WRANGLER_VERSION = '4.151.0';

export async function loadVerifiedWrangler({ purpose, missingMessage }) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    let executable;
    try { executable = await realpath(join(directory, 'wrangler')); } catch { continue; }
    const packageJson = JSON.parse(await readFile(resolve(dirname(executable), '../package.json'), 'utf8'));
    assert.equal(packageJson.version, PINNED_WRANGLER_VERSION,
      `Refusing ${purpose} with Wrangler ${String(packageJson.version)}; expected ${PINNED_WRANGLER_VERSION}.`);
    return import(pathToFileURL(resolve(dirname(executable), '../wrangler-dist/cli.js')).href);
  }
  throw new Error(missingMessage);
}
