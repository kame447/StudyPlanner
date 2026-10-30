// Local only. --check prepares DEV requests without starting a preview or calling a provider.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  if (process.env.VNEXT_JEV_REMOTE !== '1' || process.env.CI) throw new Error('Local opt-in required.');
  const args = process.argv.slice(2);
  const value = flag => args[args.indexOf(flag) + 1];
  const splitHash = value('--split-hash'), devHash = value('--dev-hash'), codeHead = value('--code-head');
  if (!args.includes('--split-hash') || !args.includes('--dev-hash') || !args.includes('--code-head')
    || !/^[a-f0-9]{64}$/.test(splitHash) || !/^[a-f0-9]{64}$/.test(devHash) || !/^[a-f0-9]{40}$/.test(codeHead)) throw new Error('Frozen inputs required.');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const currentHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (currentHead() !== codeHead) throw new Error('Frozen HEAD mismatch.');
  const directory = await mkdtemp(join(tmpdir(), 'vnext-jev-dev-runner-'));
  try {
    const outputModule = join(directory, 'collector.mjs');
    // Import only the approved DEV export. No combined cases or holdout accessor is exposed here.
    const source = `export { VNEXT_JEV_COMPARISON_DEV_CASES as cases, VNEXT_JEV_COMPARISON_SPLIT_SHA256 as splitHash,
      VNEXT_JEV_COMPARISON_DEV_CASES_SHA256 as devHash } from ${JSON.stringify(join(root, 'src/features/weeklyPlanning/evals/vnextJevComparisonCases.ts'))};
      export { devCasesHash, prepareVNextJevDevCase, collectVNextJevDevRaw } from ${JSON.stringify(join(root, 'scripts/vnext-jev-remote-dev.ts'))};
      export { startVNextJevRemote } from ${JSON.stringify(join(root, 'scripts/vnext-jev-remote.ts'))};`;
    const built = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node',
      format: 'esm', write: false, outfile: outputModule, logLevel: 'silent',
      plugins: [{ name: 'verified-wrangler-url', setup(builder) {
        builder.onResolve({ filter: /verified-wrangler\.mjs$/ }, () => ({ path: pathToFileURL(join(root, 'scripts/verified-wrangler.mjs')).href, external: true }));
      } }], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      define: { 'import.meta.env': '{}', 'import.meta.url': JSON.stringify(pathToFileURL(join(root, 'scripts/vnext-jev-remote.ts')).href) },
    });
    await writeFile(outputModule, built.outputFiles[0].text);
    const collector = await import(pathToFileURL(outputModule).href);
    if (collector.splitHash !== splitHash || collector.devHash !== devHash || collector.devCasesHash(collector.cases) !== devHash
      || collector.cases.length !== 16) throw new Error('Frozen development corpus mismatch.');
    const prepared = await Promise.all(collector.cases.map(collector.prepareVNextJevDevCase));
    const shapes = {};
    for (const item of prepared) shapes[item.menuShape] = (shapes[item.menuShape] ?? 0) + 1;
    if (args.includes('--check')) {
      console.info(JSON.stringify({ codeHead, splitHash, devCasesHash: devHash, caseCount: prepared.length, shapes, providerCalls: 0 }));
      return;
    }
    if (currentHead() !== codeHead) throw new Error('Frozen HEAD changed before collection.');
    const artifactPath = join(homedir(), '.agentstack/reviews/20261030-studyplanner-vnext-implementation', `jev-dev-raw-${splitHash}.json`);
    await mkdir(dirname(artifactPath), { recursive: true });
    // An existing complete/partial collection is never overwritten or silently repeated.
    const claim = await open(artifactPath, 'wx', 0o600);
    await claim.writeFile(JSON.stringify({ completed: false, codeHead, splitHash, devCasesHash: devHash, calls: [] }));
    await claim.close();
    const temporaryArtifact = `${artifactPath}.${process.pid}.partial`;
    const remote = await collector.startVNextJevRemote({ worker: 'studyplanner-ai-proxy', ttlMs: 900_000 });
    try {
      const artifact = await collector.collectVNextJevDevRaw({ cases: collector.cases, splitHash, expectedDevHash: devHash, codeHead, remote,
        persist: async artifact => {
          await writeFile(temporaryArtifact, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
          await rename(temporaryArtifact, artifactPath);
        },
      });
      console.info(JSON.stringify({ artifactPath, completed: artifact.completed, calls: artifact.calls.length, usage: artifact.usage }));
    } finally { await remote.stop(); await rm(temporaryArtifact, { force: true }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(() => {
  console.error('VNext DEV-only raw collection failed. No automatic retry; retain any partial artifact for diagnosis.');
  process.exitCode = 1;
});
