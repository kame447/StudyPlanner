import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

/** Offline only: Vite loads the same TS reducer used by tests; no server is listened on. */
export async function runSemanticCensus(args) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const value = (flag) => { const index = args.indexOf(flag); return index === -1 ? undefined : args[index + 1]; };
  const input = value('--input'); const output = value('--output');
  if (!input && !args.includes('--inventory')) throw new Error('Pass --inventory or --input <normalized offline artifact.json>.');
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' });
  try {
    const { buildSemanticCensus, parseCensusArtifact } = await server.ssrLoadModule('/scripts/semantic-dispatch-census-core.ts');
    let rows; let artifacts;
    if (input) {
      const parsed = JSON.parse(await readFile(resolve(input), 'utf8'));
      rows = parseCensusArtifact(parsed); artifacts = [{ kind: 'provided_normalized_offline_artifact', turns: rows.length }];
    } else {
      const { repositoryCensusInventory } = await server.ssrLoadModule('/scripts/semantic-dispatch-census-inventory.ts');
      ({ rows, artifacts } = await repositoryCensusInventory(root));
    }
    const report = { ...buildSemanticCensus(rows), artifacts };
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (output) await writeFile(resolve(output), serialized, { flag: 'wx' });
    return report;
  } finally { await server.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await runSemanticCensus(process.argv.slice(2));
  if (process.argv.includes('--output')) console.log(JSON.stringify({ populations: report.populations.length, turns: report.populations.reduce((sum, group) => sum + group.allTurns, 0), actualFrequency: report.actualFrequency }));
  else console.log(JSON.stringify(report, null, 2));
}
