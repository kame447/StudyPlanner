import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(harnessDir, '../../..');
const observabilityConsumers = [
  'src/components/AdminOverviewPage.tsx',
  'src/components/AdminUsersPage.tsx',
  'src/components/AdminUserDetailPage.tsx',
  'src/components/AdminAiApiPage.tsx',
].map((value) => path.normalize(value));
const observabilityStub = path.resolve(harnessDir, 'adminObservabilityService.stub.js');

function stripViteQuery(id) {
  return id.split('?', 1)[0];
}

const observabilityStubPlugin = {
  name: 'studyplanner-admin-observability-stub',
  enforce: 'pre',
  resolveId(source, importer) {
    const normalizedImporter = importer ? path.normalize(stripViteQuery(importer)) : '';
    if (
      source === '../services/adminObservabilityService'
      && observabilityConsumers.some((suffix) => normalizedImporter.endsWith(suffix))
    ) {
      return observabilityStub;
    }
    return null;
  },
};

export default defineConfig({
  root: harnessDir,
  plugins: [observabilityStubPlugin, react()],
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    fs: {
      allow: [repositoryRoot],
    },
  },
});
