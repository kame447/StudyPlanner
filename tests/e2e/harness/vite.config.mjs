import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
// A second instance of the same harness (own port) enables the Issue #488 architecture
// evaluation gate, so the evaluation strip/selector never appears in the other specs.
const architectureEvaluation = process.env.STUDYPLANNER_E2E_ARCHITECTURE_SWITCH === '1';
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
      source === './weeklyPlanningTurnRuntimeGateway'
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
    'import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED': JSON.stringify('false'),
    // This synthetic harness must not inherit live Firebase/AI credentials.
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(''),
    'import.meta.env.VITE_APP_ACCESS_KEY': JSON.stringify(''),
    ...(architectureEvaluation
      ? { 'import.meta.env.VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED': JSON.stringify('1') }
      : {}),
  },
  server: {
    host: '127.0.0.1',
    port: architectureEvaluation ? 4175 : 4174,
    strictPort: true,
    fs: {
      allow: [...new Set([repositoryRoot, path.dirname(fs.realpathSync(path.join(repositoryRoot, 'src')))])],
    },
  },
});
