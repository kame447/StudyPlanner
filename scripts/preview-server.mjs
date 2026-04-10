import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePreferredLanIp } from './dev-network-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');
const certDirectory = path.join(projectRoot, '.cert');
const certFilePath = path.join(certDirectory, 'study-planner-local.pem');
const keyFilePath = path.join(certDirectory, 'study-planner-local-key.pem');
const port = Number.parseInt(process.env.PREVIEW_PORT ?? '4173', 10);
const host = '0.0.0.0';

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

server.listen(
  {
    host,
    port,
  },
  () => {
    const address = server.address();
    const boundHost =
      address && typeof address === 'object' ? address.address : host;

    console.log(`\n  ➜  Local:   ${protocol}://localhost:${port}/`);

    console.log(`  ➜  Bound:   ${String(boundHost)}:${port}`);

    if (preferredLanIp) {
      console.log(`  ➜  推奨URL: ${protocol}://${preferredLanIp}:${port}/`);
    }
  },
);
