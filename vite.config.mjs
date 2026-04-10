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
