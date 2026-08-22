import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolvePreferredLanIp } from './scripts/dev-network-config.mjs';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const certDirectory = path.join(workspaceDir, '.cert');

function resolveLocalHttpsOptions() {
  const certFilePath =
    process.env.DEV_HTTPS_CERT_FILE?.trim() ||
    path.join(certDirectory, 'study-planner-local.pem');
  const keyFilePath =
    process.env.DEV_HTTPS_KEY_FILE?.trim() ||
    path.join(certDirectory, 'study-planner-local-key.pem');

  if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
    return false;
  }

  return {
    cert: fs.readFileSync(certFilePath),
    key: fs.readFileSync(keyFilePath),
  };
}

function preferredNetworkUrlPlugin() {
  const preferredLanIp = resolvePreferredLanIp();
  const printPreferredUrl = (protocol, port) => {
    if (!preferredLanIp || !port) {
      return;
    }

    console.log(`\n  ➜  推奨URL: ${protocol}://${preferredLanIp}:${port}/`);
  };

  return {
    name: 'preferred-network-url',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const protocol = server.config.server.https ? 'https' : 'http';
        printPreferredUrl(protocol, server.config.server.port);
      });
    },
    configurePreviewServer(server) {
      server.httpServer?.once('listening', () => {
        const protocol = server.config.preview.https ? 'https' : 'http';
        printPreferredUrl(protocol, server.config.preview.port ?? 4173);
      });
    },
  };
}

function resolveVendorChunk(id) {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  if (id.includes('/firebase/') || id.includes('/@firebase/')) {
    return 'vendor-firebase';
  }

  if (
    id.includes('/react/') ||
    id.includes('/react-dom/') ||
    id.includes('/scheduler/')
  ) {
    return 'vendor-react';
  }

  if (id.includes('/lucide-react/')) {
    return 'vendor-icons';
  }

  return 'vendor-runtime';
}

export default defineConfig({
  plugins: [react(), preferredNetworkUrlPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: resolveVendorChunk,
      },
    },
  },
  test: {
    alias: {
      'cloudflare:workers': path.join(
        workspaceDir,
        'workers/ai-proxy/src/cloudflareWorkersVitestStub.ts',
      ),
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'tests/e2e/**',
    ],
  },
  server: {
    host: '0.0.0.0',
    https: resolveLocalHttpsOptions(),
  },
  preview: {
    host: '0.0.0.0',
    https: resolveLocalHttpsOptions(),
  },
});
