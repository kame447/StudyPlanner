// Fixed synthetic t1, ten interpreter invocations, maximum twenty physical Luna requests.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  if (process.env.VNEXT_JEV_REMOTE !== '1' || process.env.CI) throw new Error('Local opt-in required.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const codeHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const directory = await mkdtemp(join(tmpdir(), 'vnext-period-repro-'));
  try {
    const outputModule = join(directory, 'repro.mjs');
    const built = await build({ entryPoints: [join(root, 'scripts/vnext-jev-remote-period-repro.ts')], bundle: true,
      platform: 'node', format: 'esm', write: false, outfile: outputModule, logLevel: 'silent',
      plugins: [{ name: 'verified-wrangler-url', setup(builder) {
        builder.onResolve({ filter: /verified-wrangler\.mjs$/ }, () => ({
          path: pathToFileURL(join(root, 'scripts/verified-wrangler.mjs')).href, external: true,
        }));
      } }], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      define: { 'import.meta.env': '{}', 'import.meta.url': JSON.stringify(pathToFileURL(join(root, 'scripts/vnext-jev-remote.ts')).href) },
    });
    await writeFile(outputModule, built.outputFiles[0].text);
    const repro = await import(pathToFileURL(outputModule).href);
    if (process.argv.includes('--check')) return;
    const outputPath = join(homedir(), '.agentstack/reviews/20261030-studyplanner-vnext-implementation', `vnext-named-period-repro-${codeHead.slice(0, 8)}.json`);
    await repro.runNamedPeriodReproduction({ codeHead, outputPath });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(() => { console.error('VNext named-period reproduction failed. No automatic retry.'); process.exitCode = 1; });
