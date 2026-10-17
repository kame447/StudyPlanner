import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePreferredLanIp } from './dev-network-config.mjs';
import { respondWithPreviewVideo } from './preview-media-response.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');
const certDirectory = path.join(projectRoot, '.cert');
const certFilePath = path.join(certDirectory, 'study-planner-local.pem');
const keyFilePath = path.join(certDirectory, 'study-planner-local-key.pem');
const port = Number.parseInt(process.env.PREVIEW_PORT ?? '4173', 10);

export function resolvePreviewHost(
  configuredHost = process.env.STUDYPLANNER_DEV_HOST,
  args = process.argv.slice(2),
) {
  const hostOptionIndex = args.indexOf('--host');
  const hostOption = args.find((argument) => argument.startsWith('--host='))?.slice('--host='.length)
    ?? (hostOptionIndex >= 0 ? args[hostOptionIndex + 1] : undefined);

  return hostOption?.trim() || configuredHost?.trim() || '127.0.0.1';
}

const host = resolvePreviewHost();

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

function respondWithFile(filePath, request, response) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.mp4') {
    respondWithPreviewVideo(filePath, request, response);
    return;
  }
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

export function createPreviewServer({ distDirectory: previewDistDirectory, httpsOptions = null }) {
  const indexHtmlPath = path.join(previewDistDirectory, 'index.html');
  const protocol = httpsOptions ? 'https' : 'http';
  const requestListener = (request, response) => {
    let resolvedPath;

    try {
      const requestUrl = new URL(request.url ?? '/', `${protocol}://localhost`);
      const normalizedPath = decodeURIComponent(requestUrl.pathname);
      const candidatePath = path.resolve(
        previewDistDirectory,
        normalizedPath === '/' ? 'index.html' : `.${normalizedPath}`,
      );
      const relativePath = path.relative(previewDistDirectory, candidatePath);

      if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('許可されていないパスです。');
        return;
      }

      resolvedPath = candidatePath;
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('不正なリクエストパスです。');
      return;
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      respondWithFile(resolvedPath, request, response);
      return;
    }

    respondWithFile(indexHtmlPath, request, response);
  };

  return httpsOptions
    ? https.createServer(httpsOptions, requestListener)
    : http.createServer(requestListener);
}

export function startPreviewServer() {
  if (!fs.existsSync(distDirectory)) {
    throw new Error('dist が見つかりません。先に npm run build を実行してください。');
  }

  const httpsOptions = getLocalHttpsOptions();
  const protocol = httpsOptions ? 'https' : 'http';
  const preferredLanIp = resolvePreferredLanIp();
  const server = createPreviewServer({ distDirectory, httpsOptions });
  server.listen({ host, port }, () => {
    const address = server.address();
    const boundHost = address && typeof address === 'object' ? address.address : host;

    console.log(`\n  ➜  Local:   ${protocol}://localhost:${port}/`);
    console.log(`  ➜  Bound:   ${String(boundHost)}:${port}`);

    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && preferredLanIp) {
      console.log(`  ➜  推奨URL: ${protocol}://${preferredLanIp}:${port}/`);
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    startPreviewServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
