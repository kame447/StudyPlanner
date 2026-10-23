import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PINNED_WRANGLER_VERSION } from '../verified-wrangler.mjs';

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
    expect(PINNED_WRANGLER_VERSION).toBe(pinnedVersion);
    expect(source).toContain("import { loadVerifiedWrangler, PINNED_WRANGLER_VERSION } from './verified-wrangler.mjs'");
    expect(source).toContain('return loadVerifiedWrangler({');
  });

  it('keeps the executable README example aligned with the pin', () => {
    const readme = fs.readFileSync(new URL('README.md', root), 'utf8');
    expect(readme).toContain(`--package=wrangler@${pinnedVersion} -- node scripts/jev-cloud-smoke.mjs`);
  });

  it('uses the patched transport from the real Miniflare installation', () => {
    expect(manifest.overrides['miniflare@5.20261012.0-beta']).toEqual({ undici: '7.30.1' });
    const miniflareRequire = createRequire(require.resolve('miniflare'));
    expect(miniflareRequire('undici/package.json').version).toBe('7.30.1');
  });

  it('resolves the patched native image dependency from the pinned Miniflare', () => {
    const miniflareRequire = createRequire(require.resolve('miniflare'));
    expect(manifest.overrides['miniflare@5.20261001.0-alpha']).toEqual({ sharp: '0.35.5' });
    const sharp = miniflareRequire('sharp');
    expect(sharp.versions.sharp).toBe('0.35.5');
    expect(sharp.versions.rsvg).toBe('2.63.2');
  });

  it('records the still-unpatched embedded CLI transport separately from the Miniflare mitigation', () => {
    const wranglerPackagePath = require.resolve('wrangler/package.json');
    const installed = JSON.parse(fs.readFileSync(wranglerPackagePath, 'utf8'));
    expect(installed.version).toBe(pinnedVersion);
    const cli = fs.readFileSync(resolve(dirname(wranglerPackagePath), 'wrangler-dist/cli.js'), 'utf8');
    // This is a known unresolved risk, not a patched-transport assertion.
    // The scoped Miniflare override cannot rewrite Wrangler's embedded dependency.
    // Published bundle module paths identify the embedded copy that npm audit cannot see.
    const embeddedVersions = [...new Set([...cli.matchAll(/\.pnpm\/undici@([^/]+)\/node_modules\/undici\//g)].map((match) => match[1]))];
    expect(embeddedVersions).toEqual(['7.29.1']);
  });
});
