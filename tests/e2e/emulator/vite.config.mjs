// The real application as a production build on a local preview server, backed by the Firebase Auth and Firestore emulators (#947).
// No production URL, project or credential is reachable from this target: the Firebase config is the
// emulator-only demo project and the AI proxy is the local Worker (tests/e2e/emulator/worker), whose own
// outbound requests go only to the emulators and the synthetic provider, so nothing leaves the machine.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import applicationConfig from '../../../vite.config.mjs';

const emulatorDir = path.dirname(fileURLToPath(import.meta.url));
const firebaseClient = path.resolve(emulatorDir, '../../../src/lib/firebaseClient.ts');
const emulatorClient = path.resolve(emulatorDir, 'firebaseClient.emulator.js');

// The durable-turn target (#926): the same production build with VITE_DURABLE_WEEKLY_TURNS on, so the page talks
// to the Worker's durable turn job exactly as in production, while the model stays the synthetic provider.
// It is a second build and preview server with its own output directory, port and Worker URL, selected only by
// STUDYPLANNER_E2E_DURABLE=1; every other target is unchanged.
const durableTurns = process.env.STUDYPLANNER_E2E_DURABLE === '1';
const workerPort = process.env.STUDYPLANNER_E2E_WORKER_PORT ?? '18787';
const appPort = Number(process.env.STUDYPLANNER_E2E_APP_PORT ?? 4176);

// Variables already in the environment take precedence over .env files, so a developer's local
// production values cannot leak into this target.
Object.assign(process.env, {
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-studyplanner.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-studyplanner',
  VITE_FIREBASE_APP_ID: 'demo-app-id',
  VITE_FIREBASE_STORAGE_BUCKET: '',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '',
  VITE_FIREBASE_MEASUREMENT_ID: '',
  VITE_CLOUDFLARE_AI_PROXY_URL: `http://127.0.0.1:${workerPort}`,
  VITE_WEEKLY_PLANNING_TRACE_ENABLED: 'true',
  // The real-API workflow and the durable-turn target (#926) build the production durable path; every other
  // target does not.
  VITE_DURABLE_WEEKLY_TURNS: process.env.STUDYPLANNER_E2E_REAL_API === '1' || durableTurns ? 'enabled' : 'disabled',
  // Exercise the production VNext composition even if the shell selected a local V5 comparison.
  VITE_WEEKLY_PLANNING_CORE: 'vnext',
  // Ports from firebase.emulator-e2e.json, apart from the defaults other local tools often hold.
  VITE_E2E_AUTH_EMULATOR_HOST: '127.0.0.1:9199',
  VITE_E2E_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180',
});

const emulatorClientPlugin = {
  name: 'studyplanner-firebase-emulator-client',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || path.normalize(importer.split('?', 1)[0]) === emulatorClient) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved && path.normalize(resolved.id.split('?', 1)[0]) === firebaseClient ? emulatorClient : null;
  },
};

// A production build, as deployed: the dev server's StrictMode double effects are not production behavior.
export default mergeConfig(applicationConfig, {
  plugins: [emulatorClientPlugin],
  build: { outDir: durableTurns ? 'artifacts/emulator-dist-durable' : 'artifacts/emulator-dist', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: appPort, strictPort: true, https: false },
});
