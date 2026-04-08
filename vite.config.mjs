import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const certDirectory = path.join(workspaceDir, '.cert');

function resolvePreferredLanIp() {
  const manualOverride = process.env.DEV_LAN_HOST?.trim();
  if (manualOverride) {
    return manualOverride;
  }

  if (process.platform === 'win32') {
    const ipconfigResult = spawnSync('ipconfig', [], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (ipconfigResult.status === 0 && ipconfigResult.stdout) {
      const wifiBlockMatch = ipconfigResult.stdout.match(
        /Wireless LAN adapter Wi-Fi:[\s\S]*?(?=\r?\n\r?\n\S|\r?\n\S|\s*$)/i,
      );

      if (wifiBlockMatch?.[0]) {
        const ipv4Match = wifiBlockMatch[0].match(/IPv4 Address[^\d]*(\d+\.\d+\.\d+\.\d+)/i);

        if (ipv4Match?.[1]) {
          return ipv4Match[1];
        }
      }
    }
  }

  const interfaces = os.networkInterfaces();
  const allEntries = Object.entries(interfaces).flatMap(([interfaceName, addresses]) =>
    (addresses ?? []).map((address) => ({
      interfaceName,
      ...address,
    })),
  );

  const privateIpv4Entries = allEntries.filter((entry) => {
    if (entry.internal || entry.family !== 'IPv4') {
      return false;
    }

    return (
      entry.address.startsWith('192.168.') ||
      entry.address.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address)
    );
  });

  const scoredEntries = privateIpv4Entries
    .map((entry) => {
      const normalizedInterfaceName = entry.interfaceName.toLowerCase();
      let score = 0;

      if (/wi-?fi|wireless|wlan/.test(normalizedInterfaceName)) {
        score += 100;
      }

      if (entry.address.startsWith('192.168.')) {
        score += 50;
      } else if (entry.address.startsWith('10.')) {
        score += 20;
      } else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address)) {
        score += 10;
      }

      if (
        normalizedInterfaceName.includes('proton') ||
        normalizedInterfaceName.includes('wsl') ||
        normalizedInterfaceName.includes('hyper-v') ||
        normalizedInterfaceName.includes('virtual') ||
        normalizedInterfaceName.includes('vethernet') ||
        normalizedInterfaceName.includes('loopback') ||
        normalizedInterfaceName.includes('vmware') ||
        normalizedInterfaceName.includes('docker') ||
        normalizedInterfaceName.includes('tailscale')
      ) {
        score -= 100;
      }

      return { ...entry, score };
    })
    .sort((left, right) => right.score - left.score);

  const preferredEntry = scoredEntries[0];

  return preferredEntry?.address ?? null;
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
