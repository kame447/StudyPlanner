// Starts the isolated E2E Worker with `wrangler dev` on 127.0.0.1:18787 (#947). Every credential is
// generated here for this run only and is meaningless outside the emulators: no production secret is
// read, and the Worker's outbound requests are redirected by emulatorWorker.mjs.
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workerDir, '../../../..');
const TRACE_EPOCH_MS = 30 * 24 * 60 * 60 * 1000;

// Jev routing exactly as production configures it (#305), from the deployed Worker's own config.
const productionVars = JSON.parse(readFileSync(path.join(repoRoot, 'workers/ai-proxy/wrangler.jsonc'), 'utf8')).vars;
const jevRouting = Object.fromEntries(Object.entries(productionVars).filter(([name]) => name.startsWith('JEV_')));

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const vars = {
  ...jevRouting,
  ENVIRONMENT: 'e2e-emulator',
  FIREBASE_PROJECT_ID: 'demo-studyplanner',
  FIREBASE_WEB_API_KEY: 'demo-api-key',
  FIREBASE_SERVICE_ACCOUNT_EMAIL: 'e2e-emulator@demo-studyplanner.iam.gserviceaccount.com',
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  OPENAI_API_KEY: 'synthetic-provider-key',
  OPENAI_BASE_URL: 'http://127.0.0.1:18790/v1',
  OPENROUTER_API_KEY: 'synthetic-provider-key',
  ALLOWED_ORIGIN: 'http://127.0.0.1:4176',
  ALLOWED_CHAT_MODELS: 'gpt-6-luna,gpt-5.6-luna',
  OBSERVABILITY_IDENTITY_SECRET: randomBytes(32).toString('hex'),
  WEEKLY_PLANNING_TRACE_HMAC_SECRETS: JSON.stringify({
    [String(Math.floor(Date.now() / TRACE_EPOCH_MS))]: randomBytes(32).toString('hex'),
  }),
  WEEKLY_PLANNING_TRACE_WORKER_REVISION: 'e2e-emulator',
  SEMANTIC_CENSUS_MODE: 'off',
  DURABLE_WEEKLY_TURNS: 'disabled',
};

const child = spawn(process.execPath, [
  path.join(repoRoot, 'node_modules/wrangler/bin/wrangler.js'), 'dev',
  '--config', path.join(workerDir, 'wrangler.jsonc'),
  '--ip', '127.0.0.1', '--port', '18787', '--local',
  '--persist-to', path.join(repoRoot, 'artifacts/emulator-wrangler-state'),
  ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
], { cwd: repoRoot, stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
