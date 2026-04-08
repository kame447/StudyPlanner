import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');
const certDirectory = path.join(projectRoot, '.cert');
const certFilePath = path.join(certDirectory, 'study-planner-local.pem');
const keyFilePath = path.join(certDirectory, 'study-planner-local-key.pem');
const port = Number.parseInt(process.env.PREVIEW_PORT ?? '4173', 10);
const host = process.env.PREVIEW_HOST?.trim() || '0.0.0.0';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

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

  return scoredEntries[0]?.address ?? null;
}

function getLocalHttpsOptions() {
  if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
    return null;
  }

  return {
    cert: fs.readFileSync(certFilePath),
    key: fs.readFileSync(keyFilePath),
  };
}

function respondWithFile(filePath, response) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] ?? 'application/octet-stream';
  const stream = fs.createReadStream(filePath);

  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });

  stream.pipe(response);
  stream.on('error', () => {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ファイルの読み込みに失敗しました。');
  });
}

if (!fs.existsSync(distDirectory)) {
  console.error('dist が見つかりません。先に npm run build を実行してください。');
  process.exit(1);
}

const indexHtmlPath = path.join(distDirectory, 'index.html');
const httpsOptions = getLocalHttpsOptions();
const protocol = httpsOptions ? 'https' : 'http';
const preferredLanIp = resolvePreferredLanIp();

const requestListener = (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `${protocol}://localhost`);
  const normalizedPath = decodeURIComponent(requestUrl.pathname);
  const candidatePath = normalizedPath === '/' ? indexHtmlPath : path.join(distDirectory, normalizedPath);
  const resolvedPath = path.resolve(candidatePath);

  if (!resolvedPath.startsWith(distDirectory)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('許可されていないパスです。');
    return;
  }

  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    respondWithFile(resolvedPath, response);
    return;
  }

  respondWithFile(indexHtmlPath, response);
};

const server = httpsOptions
  ? https.createServer(httpsOptions, requestListener)
  : http.createServer(requestListener);

server.listen(port, host, () => {
  console.log(`\n  ➜  Local:   ${protocol}://localhost:${port}/`);

  if (preferredLanIp) {
    console.log(`  ➜  推奨URL: ${protocol}://${preferredLanIp}:${port}/`);
  }
});
