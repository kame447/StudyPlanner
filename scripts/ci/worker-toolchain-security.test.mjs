import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const manifest = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
const pinnedVersion = manifest.devDependencies.wrangler;
const launchers = [
  'jev-cloud-smoke', 'jev-contextual-cloud-eval', 'jev-first-remote-eval',
  'jev-temporal-cloud-eval', 'jev-user-context-remote-eval',
];

describe('Worker toolchain security and launcher pin contract', () => {
  it.each(launchers)('keeps %s on the exact supported toolchain', (launcher) => {
    const source = fs.readFileSync(new URL(`scripts/${launcher}.mjs`, root), 'utf8');
    expect(source.match(/const PINNED_WRANGLER_VERSION = '([^']+)'/)?.[1]).toBe(pinnedVersion);
    expect(source).toMatch(/assert\.equal\(\s*packageJson\.version,\s*PINNED_WRANGLER_VERSION/);
  });

  it('keeps the executable README example aligned with the pin', () => {
    const readme = fs.readFileSync(new URL('README.md', root), 'utf8');
    expect(readme).toContain(`--package=wrangler@${pinnedVersion} -- node scripts/jev-cloud-smoke.mjs`);
  });

  it('uses the patched transport from the real Miniflare installation', () => {
    const miniflareRequire = createRequire(require.resolve('miniflare'));
    expect(miniflareRequire('undici/package.json').version).toBe('7.29.1');
  });

  it('checks the embedded CLI transport as well as the separately audited dependency', () => {
    const wranglerPackagePath = require.resolve('wrangler/package.json');
    const installed = JSON.parse(fs.readFileSync(wranglerPackagePath, 'utf8'));
    expect(installed.version).toBe(pinnedVersion);
    const cli = fs.readFileSync(resolve(dirname(wranglerPackagePath), 'wrangler-dist/cli.js'), 'utf8');
    // Published bundle module paths identify the embedded copy that npm audit cannot see.
    const embeddedVersions = [...new Set([...cli.matchAll(/\.pnpm\/undici@([^/]+)\/node_modules\/undici\//g)].map((match) => match[1]))];
    expect(embeddedVersions).toEqual(['7.29.1']);
  });
});
