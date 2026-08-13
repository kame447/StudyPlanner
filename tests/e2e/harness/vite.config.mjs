import path from 'node:path';
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

const runtimeGatewayStubPlugin = {
  name: 'studyplanner-weekly-runtime-gateway-stub',
  enforce: 'pre',
  resolveId(source, importer) {
    const normalizedImporter = importer
      ? path.normalize(stripViteQuery(importer))
      : '';
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
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
    fs: {
      allow: [repositoryRoot],
    },
  },
});
