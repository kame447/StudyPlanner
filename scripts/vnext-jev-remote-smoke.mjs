// VNEXT_JEV_REMOTE=1 npm exec --package=wrangler@4.151.0 -- node scripts/vnext-jev-remote-smoke.mjs
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
let stage = 'options';

async function main() {
  if (process.env.VNEXT_JEV_REMOTE !== '1' || process.env.CI) throw new Error('Local opt-in required.');
  const mode = process.argv[2] ?? '--smoke';
  if (!['--smoke', '--check-bundle', '--ready-only', '--luna-only', '--jev-only'].includes(mode)) throw new Error('Unknown smoke mode.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(tmpdir(), 'vnext-jev-smoke-runner-'));
  try {
    const output = join(directory, 'smoke.mjs');
    // Bundle repository TS while preserving Wrangler's own module-relative loader.
    stage = 'bundle';
    const result = await build({ entryPoints: [join(root, 'scripts/vnext-jev-remote-smoke.ts')], bundle: true,
      platform: 'node', format: 'esm', write: false, outfile: output, logLevel: 'silent',
      plugins: [{ name: 'verified-wrangler-url', setup(builder) {
        builder.onResolve({ filter: /verified-wrangler\.mjs$/ }, () => ({
          path: pathToFileURL(join(root, 'scripts/verified-wrangler.mjs')).href, external: true,
        }));
      } }],
      banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      define: { 'import.meta.env': '{}', 'import.meta.url': JSON.stringify(pathToFileURL(join(root, 'scripts/vnext-jev-remote.ts')).href) },
    });
    await writeFile(output, result.outputFiles[0].text);
    stage = 'import';
    const smoke = await import(pathToFileURL(output).href);
    stage = 'preview';
    if (mode !== '--check-bundle') await smoke.runVNextJevRemoteSmoke(
      mode === '--ready-only' ? 'ready' : mode === '--luna-only' ? 'luna' : mode === '--jev-only' ? 'jev' : 'both');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => {
  const allowed = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'];
  const code = allowed.includes(error?.code) ? error.code
    : error instanceof SyntaxError ? 'syntax' : error instanceof ReferenceError ? 'reference' : 'unavailable';
  console.error(`VNext remote smoke failed at ${stage} (${code}). Check the verified Wrangler session and safe usage diagnostics.`);
  process.exitCode = 1;
});
