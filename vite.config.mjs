import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolvePreferredLanIp } from './scripts/dev-network-config.mjs';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const certDirectory = path.join(workspaceDir, '.cert');
const loopbackHost = '127.0.0.1';

function resolveDevelopmentHost() {
  return process.env.STUDYPLANNER_DEV_HOST?.trim() || loopbackHost;
}

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
  const printPreferredUrl = (protocol, port, host) => {
    const isLoopbackHost =
      !host || host === loopbackHost || host === 'localhost' || host === '::1';
    if (isLoopbackHost || !preferredLanIp || !port) {
      return;
    }

    console.log(`\n  ➜  推奨URL: ${protocol}://${preferredLanIp}:${port}/`);
  };

  return {
    name: 'preferred-network-url',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const protocol = server.config.server.https ? 'https' : 'http';
        printPreferredUrl(protocol, server.config.server.port, server.config.server.host);
      });
    },
    configurePreviewServer(server) {
      server.httpServer?.once('listening', () => {
        const protocol = server.config.preview.https ? 'https' : 'http';
        printPreferredUrl(
          protocol,
          server.config.preview.port ?? 4173,
          server.config.preview.host,
        );
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
  // Worker dynamic imports must remain split; no inference dependency in app entry.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
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
      '.stryker-tmp/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'tests/e2e/**',
    ],
  },
  server: {
    host: resolveDevelopmentHost(),
    fs: {
      deny: [
        // Keep Vite's default deny entries: env files, private keys/certificates, and Git internals.
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        // Worker secrets, generated local HTTPS keys, and Wrangler's local state.
        '.dev.vars',
        '.dev.vars.*',
        '**/.dev.vars',
        '**/.dev.vars.*',
        '**/.cert/**',
        '**/.wrangler/**',
        // Local Claude settings may contain machine-specific values and credentials.
        '**/.claude/settings.local.json',
      ],
    },
    https: resolveLocalHttpsOptions(),
  },
  preview: {
    host: resolveDevelopmentHost(),
    https: resolveLocalHttpsOptions(),
  },
});
