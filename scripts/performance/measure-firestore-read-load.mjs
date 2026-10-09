#!/usr/bin/env node
// Snapshot both inputs before executing either. Never checks out another branch,
// reads .env files, invokes a provider, or edits the source worktree.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.argv[2] ?? '22847120386987329e2f034d6062d59694ef1180';
const output = path.resolve(process.argv[3] ?? path.join(root, '.cache/firestore-read-load'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const baseCommit = git('rev-parse', '--verify', `${base}^{commit}`);
const candidateHead = git('rev-parse', 'HEAD');
const files = ['src', 'shared', 'package.json', 'package-lock.json', 'tests/performance', 'scripts/performance'];
const scratch = mkdtempSync(path.join(tmpdir(), 'studyplanner-read-load-'));
mkdirSync(output, { recursive: true });
function sha(data) { return createHash('sha256').update(data).digest('hex'); }
function manifest(dir) {
  const entries = [];
  function visit(relative) {
    const absolute = path.join(dir, relative);
    if (!existsSync(absolute)) return;
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else entries.push({ path: relative, sha256: sha(readFileSync(absolute)) });
  }
  files.forEach(visit); return { sha256: sha(JSON.stringify(entries)), files: entries };
}
try {
  const beforeDir = path.join(scratch, 'before'), afterDir = path.join(scratch, 'after');
  mkdirSync(beforeDir); mkdirSync(afterDir);
  const archive = execFileSync('git', ['archive', baseCommit, 'src', 'shared', 'package.json', 'package-lock.json'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', beforeDir], { input: archive });
  for (const file of files) if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(afterDir, file), { recursive: true });
  for (const file of ['tests/performance', 'scripts/performance']) cpSync(path.join(afterDir, file), path.join(beforeDir, file), { recursive: true });
  const inputManifests = { baseCommit, candidateHead, candidateDiffSha256: sha(git('diff', '--binary', 'HEAD')),
    node: process.version, installedDependencies: Object.fromEntries(['vitest', 'react', 'react-test-renderer', 'firebase', 'vite']
      .map(name => [name, JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version])),
    before: manifest(beforeDir), after: manifest(afterDir) };
  writeFileSync(path.join(output, 'inputs.json'), JSON.stringify(inputManifests, null, 2));
  for (const [label, dir] of [['before', beforeDir], ['after', afterDir]]) {
    symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const run = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'scripts/performance/vitest.firestore-read-load.config.mjs'], {
      cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: scratch, TZ: 'UTC', CI: 'true', DEV_LAN_HOST: '127.0.0.1',
        FIRESTORE_READ_LOAD_OUTPUT: path.join(output, `${label}.json`) },
    });
    writeFileSync(path.join(output, `${label}.log`), `${run.stdout ?? ''}${run.stderr ?? ''}`);
    process.stdout.write(`${label}: exit ${run.status}\n${run.stdout ?? ''}${run.stderr ?? ''}`);
    if (run.error || run.status !== 0) throw run.error ?? new Error(`${label} measurement failed (${run.status}); see ${output}`);
  }
  const before = JSON.parse(readFileSync(path.join(output, 'before.json'), 'utf8'));
  const after = JSON.parse(readFileSync(path.join(output, 'after.json'), 'utf8'));
  const comparison = [];
  for (let i = 0; i < before.results.length; i++) {
    const oldSet = before.results[i], newSet = after.results[i];
    if (oldSet.dataset !== newSet.dataset || oldSet.fixtureDigest !== newSet.fixtureDigest || oldSet.finalPersistedDigest !== newSet.finalPersistedDigest) throw new Error(`Fixture/persistence equivalence failed: ${oldSet.dataset}`);
    if (oldSet.rows.length !== newSet.rows.length) throw new Error('Operation count mismatch');
    for (let j = 0; j < oldSet.rows.length; j++) {
      const oldRow = oldSet.rows[j], newRow = newSet.rows[j];
      if (oldRow.operation !== newRow.operation || oldRow.dataDigest !== newRow.dataDigest || oldRow.projectionDigest !== newRow.projectionDigest
        || JSON.stringify(oldRow.view) !== JSON.stringify(newRow.view)) throw new Error(`Data/projection/navigation equivalence failed: ${oldSet.dataset}/${oldRow.operation}`);
      if (newRow.readCalls > oldRow.readCalls || newRow.returnedDocuments > oldRow.returnedDocuments) throw new Error(`Read regression: ${oldSet.dataset}/${oldRow.operation}`);
      comparison.push({ dataset: oldSet.dataset, operation: oldRow.operation, equivalent: true,
        beforeReadCalls: oldRow.readCalls, afterReadCalls: newRow.readCalls,
        beforeReturnedDocuments: oldRow.returnedDocuments, afterReturnedDocuments: newRow.returnedDocuments,
        beforeEmptyQueries: oldRow.emptyQueries, afterEmptyQueries: newRow.emptyQueries,
        beforeMissingDocumentCalls: oldRow.missingDocumentCalls, afterMissingDocumentCalls: newRow.missingDocumentCalls });
    }
  }
  if (before.results.length !== 3 || after.results.length !== 3) throw new Error('All three dataset results required');
  writeFileSync(path.join(output, 'comparison.json'), JSON.stringify({ inputs: { baseCommit, candidateHead,
    beforeSourceSha256: inputManifests.before.sha256, afterSourceSha256: inputManifests.after.sha256 },
    actualBillingMeasured: false, serverReadsMeasured: false, allEquivalent: true, comparison }, null, 2));
  console.table(comparison.map(row => ({ dataset: row.dataset, operation: row.operation,
    calls: `${row.beforeReadCalls} -> ${row.afterReadCalls}`, returned: `${row.beforeReturnedDocuments} -> ${row.afterReturnedDocuments}` })));
  console.log(`Verified source manifests, logs and JSON: ${output}`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
