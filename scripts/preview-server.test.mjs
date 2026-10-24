import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { createPreviewServer, resolvePreviewHost } from './preview-server.mjs';

const temporaryDirectories = new Set();
const runningServers = new Set();

afterEach(async () => {
  await Promise.all(
    [...runningServers].map(
      (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    ),
  );
  runningServers.clear();
  await Promise.all(
    [...temporaryDirectories].map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

async function createFixtureDist() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studyplanner-preview-'));
  temporaryDirectories.add(root);
  await fs.writeFile(path.join(root, 'index.html'), '<main>preview home</main>');
  await fs.writeFile(path.join(root, 'clip.mp4'), Buffer.from('0123456789abcdef'));
  return root;
}

async function startServer(distDirectory, host = '127.0.0.1') {
  const server = createPreviewServer({ distDirectory });
  runningServers.add(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  return { server, origin: `http://${host}:${address.port}`, port: address.port };
}

async function requestRawPath(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

describe('local preview server', () => {
  it('defaults to loopback and supports an explicit LAN bind', () => {
    assert.equal(resolvePreviewHost(''), '127.0.0.1');
    assert.equal(resolvePreviewHost('0.0.0.0'), '0.0.0.0');
    assert.equal(resolvePreviewHost('', ['--host', '0.0.0.0']), '0.0.0.0');
    assert.equal(resolvePreviewHost('', ['--host=0.0.0.0']), '0.0.0.0');
  });

  it('returns 400 for a malformed URI and remains available', async () => {
    const distDirectory = await createFixtureDist();
    const { port } = await startServer(distDirectory);

    const malformedResponse = await requestRawPath(port, '/%E0%A4%A');
    assert.equal(malformedResponse.status, 400);
    assert.ok(malformedResponse.body.length <= 128);

    const normalResponse = await requestRawPath(port, '/');
    assert.equal(normalResponse.status, 200);
    assert.match(normalResponse.body, /preview home/);
  });

  it('rejects traversal including sibling-prefix and encoded traversal paths', async () => {
    const parentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'studyplanner-preview-boundary-'));
    temporaryDirectories.add(parentDirectory);
    const distDirectory = path.join(parentDirectory, 'dist');
    const siblingDirectory = path.join(parentDirectory, 'dist-evil');
    await fs.mkdir(distDirectory);
    await fs.mkdir(siblingDirectory);
    await fs.writeFile(path.join(distDirectory, 'index.html'), '<main>safe</main>');
    await fs.writeFile(path.join(siblingDirectory, 'secret.txt'), 'outside dist');
    const { port } = await startServer(distDirectory);

    for (const requestPath of [
      '/../dist-evil/secret.txt',
      '/%2e%2e%2fdist-evil/secret.txt',
    ]) {
      const response = await requestRawPath(port, requestPath);
      assert.notEqual(response.body, 'outside dist');
    }
  });

  it('serves normal files and preserves video byte ranges', async () => {
    const distDirectory = await createFixtureDist();
    const { port } = await startServer(distDirectory);

    const indexResponse = await requestRawPath(port, '/');
    assert.equal(indexResponse.status, 200);
    assert.match(indexResponse.body, /preview home/);

    const rangeResponse = await requestRawPath(port, '/clip.mp4', {
      Range: 'bytes=3-7',
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers['content-range'], 'bytes 3-7/16');
    assert.equal(rangeResponse.body, '34567');
  });
});
