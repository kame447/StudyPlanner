import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Intentionally does not use Firebase CLI, .firebaserc, Vite, .env files, ADC,
// Auth, or the production firebaseClient module. Download this official JAR
// separately; this runner never installs software or contacts a remote service.
const PROJECT = 'demo-studyplanner-read-load';
const HOST = '127.0.0.1';
const JAR_SHA256 = '4a117fc297b1441eac1b7756e80442e86ef88865b9e3caf6f59eabf83da574f8';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jar = process.argv[2];
const replay = process.argv[3]?.startsWith('--approval-replay-') ?? false;
const approvalMode = process.argv[3]?.replace('--approval-', '').replace('replay-', '');
assert(jar && (process.argv.length === 3 ||
  (process.argv.length === 4 && /^--approval-(replay-)?(before|after)$/.test(process.argv[3]))),
  'Usage: node scripts/performance/firestore-read-load-emulator.mjs /absolute/path/cloud-firestore-emulator-v1.20.2.jar [--approval-[replay-]before|--approval-[replay-]after]');
assert(path.isAbsolute(jar), 'Emulator JAR path must be absolute.');
assert.equal(createHash('sha256').update(await readFile(jar)).digest('hex'), JAR_SHA256,
  'Use the verified official Firestore emulator v1.20.2 JAR.');

const scratch = await mkdtemp(path.join(os.tmpdir(), 'firestore-read-load-emulator-'));
const report = path.join(scratch, 'report.json');
const log = path.join(scratch, 'emulator.log');
const environment = {
  PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: scratch, TMPDIR: scratch, LANG: 'C.UTF-8',
};
const probe = net.createServer();
probe.listen(0, HOST);
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

const executable = path.join(scratch, 'integration.cjs');
const baseline = '22847120386987329e2f034d6062d59694ef1180';
const stubPrefix = 'const state = () => globalThis.__firestoreReadLoadApp;\n';
const stubs = new Map(Object.entries({
  'src/repositories/index.ts': 'export const plannerRepository = new Proxy({}, { get: (_, key) => Reflect.get(state().repository, key) });',
  'src/features/weeklyPlanning/application/weeklyPlanningApprovalPlanRepository.ts':
    'export const getWeeklyPlanningApprovalPlanRepository = () => state().approval;',
  'src/hooks/useAuthSessionState.ts': `export const useAuthSessionState = () => ({ booting: false, user: state().owner,
    bootstrapSession: state().bootstrapSession, signUpWithPassword: state().asyncNoop,
    signInWithPassword: state().asyncNoop, signInWithGoogle: state().asyncNoop,
    sendPasswordReset: state().asyncNoop, saveUserProfile: state().asyncNoop, signOut: state().asyncNoop });`,
  'src/hooks/useNoticeState.ts': 'export const useNoticeState = () => ({ notice: null, showNotice: state().noop, dismissNotice: state().noop });',
  'src/data/naturalLanguageCatalog.ts': 'export const loadNaturalLanguageCatalogWithOutcome = async () => ({ source: "server" });',
  'src/lib/id.ts': 'export const createId = prefix => `${prefix}-synthetic-${state().id++}`;',
  'src/lib/firebaseClient.ts': `export const getFirestoreDb = () => { throw new Error('Production Firebase setup forbidden'); };
    export const getFirebaseAuth = getFirestoreDb;`,
}));
const overriddenSourceHashes = new Map();
const output = await build({
  absWorkingDir: root,
  entryPoints: [approvalMode
    ? 'tests/performance/firestore-read-load-emulator.approval-entry.ts'
    : 'tests/performance/firestore-read-load-emulator.integration.ts'],
  outfile: executable, bundle: true, platform: 'node', format: 'cjs',
  packages: 'external', metafile: true,
  plugins: approvalMode ? [{ name: 'isolated-approval-boundaries', setup(plugin) {
    plugin.onLoad({ filter: /\.[jt]sx?$/ }, async ({ path: filename }) => {
      const relative = path.relative(root, filename);
      let contents;
      if (stubs.has(relative)) contents = stubPrefix + stubs.get(relative);
      else if (approvalMode === 'before' && relative.startsWith('src/')) {
        contents = execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' });
      }
      if (contents === undefined) return;
      overriddenSourceHashes.set(relative, createHash('sha256').update(contents).digest('hex'));
      return { contents, loader: filename.endsWith('tsx') ? 'tsx' : filename.endsWith('ts') ? 'ts' : 'js' };
    });
  } }] : [],
});
assert(!Object.keys(output.metafile.inputs).some(input => /firebaseClient|firebaseConfig/.test(input) &&
  !(approvalMode && stubs.has(input))),
  'The emulator harness must not import production Firebase setup.');
const verificationInputs = {
  approvalMode: approvalMode ?? null, replay, baseline: approvalMode === 'before' ? baseline : null,
  emulatorSha256: JAR_SHA256,
  rulesSha256: createHash('sha256').update(await readFile(path.join(root, 'firestore.rules'))).digest('hex'),
  bundleSha256: createHash('sha256').update(await readFile(executable)).digest('hex'),
  sourceSha256: Object.fromEntries(await Promise.all(Object.keys(output.metafile.inputs).map(async input => [
    input, overriddenSourceHashes.get(input) ?? createHash('sha256').update(await readFile(path.resolve(root, input))).digest('hex'),
  ]))),
};

let emulator;
let client;
let emulatorOutput = '';
try {
  emulator = spawn('java', [
    '-XX:ActiveProcessorCount=2', '-Xmx768m', '-jar', jar,
    '--host', HOST, '--port', String(port), '--project_id', PROJECT,
    '--single_project_mode', 'true', '--single_project_mode_error', 'true',
    '--rules', path.join(root, 'firestore.rules'),
  ], { cwd: scratch, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [emulator.stdout, emulator.stderr]) {
    stream.on('data', chunk => { emulatorOutput += chunk.toString(); });
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Emulator startup timed out.')), 30_000);
    const check = setInterval(() => {
      if (/Dev App Server is now running/.test(emulatorOutput)) finish();
    }, 100);
    const onError = error => finish(error);
    const onExit = code => finish(new Error(`Emulator exited during startup (${code}).`));
    function finish(error) {
      clearTimeout(timeout); clearInterval(check);
      emulator.off('error', onError); emulator.off('exit', onExit);
      error ? reject(error) : resolve();
    }
    emulator.once('error', onError); emulator.once('exit', onExit);
  });

  // Nothing from the invoking shell's Firebase, Google, AI, proxy, or Node
  // configuration enters either child process.
  client = spawn(process.execPath, [executable], {
    cwd: root,
    env: {
      ...environment,
      NODE_PATH: path.join(root, 'node_modules'),
      FIRESTORE_READ_LOAD_PROJECT: PROJECT,
      FIRESTORE_READ_LOAD_HOST: `${HOST}:${port}`,
      FIRESTORE_READ_LOAD_REPORT: report,
      ...(approvalMode ? { FIRESTORE_READ_LOAD_APPROVAL_MODE: approvalMode } : {}),
      ...(replay ? { FIRESTORE_READ_LOAD_APPROVAL_REPLAY: '1' } : {}),
    }, stdio: 'inherit',
  });
  const timeout = setTimeout(() => client.kill('SIGTERM'), 180_000);
  const [code, signal] = await once(client, 'exit').finally(() => clearTimeout(timeout));
  assert(code === 0 || (approvalMode && code === 2), `Emulator integration failed (${signal ?? code}).`);
  const result = JSON.parse(await readFile(report, 'utf8'));
  await writeFile(report, `${JSON.stringify({ ...result, verificationInputs }, null, 2)}\n`);
  process.stdout.write(`Report: ${report}\nEmulator log: ${log}\n`);
  // A reproduced Rules blocker is useful evidence, but is never a green test.
  if (code === 2) process.exitCode = 2;
} finally {
  if (client && client.exitCode === null && client.signalCode === null) client.kill('SIGTERM');
  if (emulator && emulator.exitCode === null && emulator.signalCode === null) {
    const exited = once(emulator, 'exit');
    emulator.kill('SIGTERM');
    const force = setTimeout(() => emulator.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(force);
  }
  await writeFile(log, emulatorOutput);
  await rm(executable, { force: true });
}
