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
  VITE_CLOUDFLARE_AI_PROXY_URL: 'http://127.0.0.1:18787',
  VITE_WEEKLY_PLANNING_TRACE_ENABLED: 'true',
  VITE_DURABLE_WEEKLY_TURNS: 'disabled',
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
  build: { outDir: 'artifacts/emulator-dist', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4176, strictPort: true, https: false },
});
