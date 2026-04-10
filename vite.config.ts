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

  return {
    name: 'preferred-network-url',
    configureServer(server: {
      httpServer?: { once: (event: string, listener: () => void) => void };
      config: { server: { port?: number; https?: unknown } };
    }) {
      server.httpServer?.once('listening', () => {
        if (!preferredLanIp || !server.config.server.port) {
          return;
        }

        const protocol = server.config.server.https ? 'https' : 'http';
        console.log(`\n  ➜  推奨URL: ${protocol}://${preferredLanIp}:${server.config.server.port}/`);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), preferredNetworkUrlPlugin()],
  server: {
    host: '0.0.0.0',
    https: resolveLocalHttpsOptions(),
  },
  preview: {
    host: '0.0.0.0',
    https: resolveLocalHttpsOptions(),
  },
});
