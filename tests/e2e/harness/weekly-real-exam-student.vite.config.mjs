import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(harnessDir, '../../..');
// No aliases at all: production App, runtime, AI gateway and local repository; the only double is
// the provider transport in the page (authored replies for a `.invalid` base URL).
export default defineConfig({
  root: harnessDir,
  cacheDir: path.join(repoRoot, 'artifacts/weekly-real-exam-student/vite-cache'),
  plugins: [react()],
  define: Object.fromEntries(Object.entries({
    VITE_WEEKLY_PLANNING_TRACE_ENABLED: 'false',
    VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED: '1',
    VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT: 'interaction_v1',
    VITE_AI_PROVIDER: 'openai', VITE_AI_BASE_URL: 'https://weekly-exam.invalid/v1',
    VITE_AI_MODEL: 'deterministic-fixture', VITE_AI_API_KEY: 'fixture-key',
    VITE_FIREBASE_API_KEY: '', VITE_FIREBASE_AUTH_DOMAIN: '', VITE_FIREBASE_PROJECT_ID: '',
    VITE_FIREBASE_APP_ID: '', VITE_APP_ACCESS_KEY: '',
  }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  server: { host: '127.0.0.1', port: 4188, strictPort: true, fs: { allow: [repoRoot] } },
});
