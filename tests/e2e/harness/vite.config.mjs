import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
// Dispatch-only actual-model checkpoint; never enabled in ordinary browser CI.
const correctionRealApi = process.env.STUDYPLANNER_CORRECTION_REAL_API === '1';
const repositoryRoot = path.resolve(harnessDir, '../../..');
const turnApplicationSuffix = path.normalize(
  'src/features/weeklyPlanning/application/weeklyPlanningTurnApplication.ts',
);
const runtimeGatewayStub = path.resolve(
  harnessDir,
  'weeklyPlanningTurnRuntimeGateway.stub.js',
);

function stripViteQuery(id) {
  return id.split('?', 1)[0];
}

// Keep weeklyPlanningRuntimeModule and its dynamic runtime import unaliased.
// Preflight must load production code; only execution results and OCR are stubbed.
const runtimeGatewayStubPlugin = {
  name: 'studyplanner-weekly-runtime-gateway-stub',
  enforce: 'pre',
  resolveId(source, importer) {
    const normalizedImporter = importer
      ? path.normalize(stripViteQuery(importer))
      : '';
    if (source === './usePlannerDataState'
      && normalizedImporter.endsWith(path.normalize('src/hooks/usePlannerAppState.ts'))) {
      return path.resolve(harnessDir, 'usePlannerDataState.control.jsx');
    }
    if (source === '../repositories'
      && ['src/hooks/usePlannerDataState.ts', 'src/hooks/useAuthSessionState.ts']
        .some(suffix => normalizedImporter.endsWith(path.normalize(suffix)))) {
      return path.resolve(harnessDir, 'plannerRecoveryRepository.fixture.js');
    }
    if (source === '../lib/planningImageAttachment'
      && normalizedImporter.endsWith(path.normalize('src/components/AiPlanningViewLegacy.tsx'))) {
      return path.resolve(harnessDir, 'planningImageAttachment.stub.js');
    }
    if (
      !correctionRealApi
      && source === './weeklyPlanningTurnRuntimeGateway'
      && normalizedImporter.endsWith(turnApplicationSuffix)
    ) {
      return runtimeGatewayStub;
    }
    return null;
  },
};

export default defineConfig({
  root: harnessDir,
  plugins: [runtimeGatewayStubPlugin, react()],
  define: {
    ...(correctionRealApi ? Object.fromEntries(Object.entries({
      VITE_AI_PROVIDER: 'openai',
      VITE_AI_BASE_URL: 'http://127.0.0.1:4174/__issue488_real_api/v1',
      VITE_AI_MODEL: 'gpt-5.6-luna',
      // A marker only. The real credential stays in the Node-side test process.
      VITE_AI_API_KEY: 'synthetic-key-not-a-credential',
      VITE_AI_MAX_PROCESS_REQUESTS: '16',
      VITE_CLOUDFLARE_AI_PROXY_URL: '',
    }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])) : {}),
    // Existing local trace records expose renderer adoption in the explicit synthetic profile.
    // Empty Firebase config below keeps this observer off Firestore.
    'import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED': JSON.stringify(correctionRealApi ? 'true' : 'false'),
    // This synthetic harness must not inherit live Firebase/AI credentials.
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(''),
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    fs: {
      allow: [...new Set([repositoryRoot, path.dirname(fs.realpathSync(path.join(repositoryRoot, 'src')))])],
    },
  },
});
