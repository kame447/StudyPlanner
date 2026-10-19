import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const childSource = `
import { buildWorkerBundle, preSendFor, writeSegmentFiles } from ${JSON.stringify(new URL('./jev-contextual-unit0-eval.mjs', import.meta.url).href)};
import { DRY_RUN_PRICING } from ${JSON.stringify(new URL('./jev-contextual-unit0-dry-run.mjs', import.meta.url).href)};
const bundle = await buildWorkerBundle({ cases: [], preSend: preSendFor(DRY_RUN_PRICING) });
const { entry, codeSha256 } = await writeSegmentFiles(bundle, process.argv[1], { digest: 'a'.repeat(64), expiresAt: 1 });
process.stdout.write(JSON.stringify({ pid: process.pid, cwd: process.cwd(), entry,
  templateSha256: bundle.templateSha256, codeSha256 }));
`;

it('writes identical Unit0 bundle bytes and hashes from fresh processes with different working directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'unit0-bundle-cwd-'));
  try {
    const foreignCwd = join(directory, 'outside repository 日本語');
    const outputs = [join(directory, 'root-output'), join(directory, 'foreign-output')];
    await Promise.all([foreignCwd, ...outputs].map(path => mkdir(path)));
    const cwds = [ROOT, foreignCwd];
    // Fresh processes are required: changing cwd after esbuild starts its
    // service in one process can hide the original comment-path defect.
    const runs = await Promise.all(cwds.map(async (cwd, index) => {
      const { stdout } = await execFileAsync(process.execPath,
        ['--input-type=module', '--eval', childSource, outputs[index]],
        { cwd, timeout: 30_000, maxBuffer: 8_192 });
      const result = JSON.parse(stdout);
      expect(result.cwd).toBe(await realpath(cwd));
      return result;
    }));
    expect(new Set(runs.map(run => run.pid)).size).toBe(2);
    expect(new Set(runs.map(run => run.cwd)).size).toBe(2);
    expect(runs[0].templateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runs[1].templateSha256).toBe(runs[0].templateSha256);
    const bytes = await Promise.all(runs.map(run => readFile(run.entry)));
    expect(bytes[1]).toEqual(bytes[0]);
    for (const [index, run] of runs.entries()) {
      expect(run.codeSha256).toBe(run.templateSha256);
      expect(createHash('sha256').update(bytes[index]).digest('hex')).toBe(run.codeSha256);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);
