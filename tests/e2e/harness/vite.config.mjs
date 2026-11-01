import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
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
    if (source === './features/weeklyPlanning/application/useWeeklyPlanningConversationApplication'
      && normalizedImporter.endsWith(path.normalize('src/App.tsx'))) {
      return '\0weekly-application-observer';
    }
    if (source === './LaplanceAppRoot' && normalizedImporter.endsWith(path.normalize('src/components/ApplicationRouteRoot.tsx'))) {
      return path.resolve(harnessDir, 'admin-entry-root.jsx');
    }
    if (source === '../services/adminService' && normalizedImporter.endsWith(path.normalize('src/hooks/useAdminStatus.ts'))) {
      return path.resolve(harnessDir, 'admin-entry-access.fixture.js');
    }
    if (source === '../services/adminObservabilityService' && normalizedImporter.includes(`${path.sep}src${path.sep}components${path.sep}Admin`)) {
      return path.resolve(harnessDir, '../admin-overview-harness/adminObservabilityService.phase8.stub.js');
    }
    if (['./firebaseClient', './aiConfig'].includes(source)
      && normalizedImporter.endsWith(path.normalize('src/lib/materialContentsPhoto.ts'))) {
      return path.resolve(harnessDir, 'material-contents-photo-auth.fixture.js');
    }
    if (source === './components/StudySessionView'
      && normalizedImporter.endsWith(path.normalize('src/App.tsx'))) {
      return path.resolve(harnessDir, 'StudySessionProvider.control.jsx');
    }
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
    if (source === './weeklyPlanningVNextRuntimeGateway'
      && normalizedImporter.endsWith(path.normalize('src/features/weeklyPlanning/vnext/application/useWeeklyPlanningVNextApplication.ts'))) {
      return runtimeGatewayStub;
    }
    return null;
  },
  load(id) {
    if (id !== '\0weekly-application-observer') return null;
    // Observe the real facade instead of rewriting either core's implementation.
    return `import { useWeeklyPlanningConversationApplication as useProduction } from ${JSON.stringify(path.join(repositoryRoot, 'src/features/weeklyPlanning/application/useWeeklyPlanningConversationApplication.ts'))};
      export function useWeeklyPlanningConversationApplication(...args) {
        const application = useProduction(...args);
        globalThis.__weeklyPlanningApplication = application;
        return application;
      }`;
  },
};

export default defineConfig({
  root: harnessDir,
  plugins: [runtimeGatewayStubPlugin, react()],
  define: {
    'import.meta.env.VITE_WEEKLY_PLANNING_CORE': JSON.stringify('vnext'),
    'import.meta.env.VITE_WEEKLY_PLANNING_TRACE_ENABLED': JSON.stringify('false'),
    // This synthetic harness must not inherit live Firebase/AI credentials.
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(''),
    'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(''),
  },
  // A cold dev server answers the first page before its dependency scan (about 5 s) has finished. Whatever the
  // browser imports that the first optimization lacks is discovered mid-load, Vite re-optimizes, and the old hashed
  // chunks answer 504 'Outdated Optimize Dep': the first page of a run stays blank (admin-entry-navigation:27 on
  // CI). Listing every dependency the harness pages import makes the first optimization complete, with no waiting.
  optimizeDeps: {
    include: ['react-dom/client', 'firebase/app', 'firebase/auth', 'firebase/firestore', 'lucide-react', 'suncalc'],
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
