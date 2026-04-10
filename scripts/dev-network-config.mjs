import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const entries = {};

  for (const line of source.split(/\r?\n/u)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    entries[key] = value.replace(/^['"]|['"]$/gu, '');
  }

  return entries;
}

function readManualLanHost() {
  const envFiles = [path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')];

  for (const envFilePath of envFiles) {
    const entries = parseEnvFile(envFilePath);
    const configuredLanHost =
      entries.DEV_LAN_HOST?.trim() || entries.VITE_DEV_LAN_HOST?.trim();

    if (configuredLanHost) {
      return configuredLanHost;
    }
  }

  return process.env.DEV_LAN_HOST?.trim() || process.env.VITE_DEV_LAN_HOST?.trim() || '';
}

export function resolvePreferredLanIp() {
  const manualOverride = readManualLanHost();

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

  return scoredEntries[0]?.address ?? null;
}
