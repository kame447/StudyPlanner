import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { createServer, loadConfigFromFile, resolveConfig } from 'vite';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const configFile = path.join(repositoryRoot, 'vite.config.mjs');
const temporaryDirectories = new Set();
const runningServers = new Set();

afterEach(async () => {
  await Promise.all([...runningServers].map((server) => server.close()));
  runningServers.clear();
  await Promise.all(
    [...temporaryDirectories].map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

async function createFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studyplanner-vite-security-'));
  temporaryDirectories.add(root);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'workers', 'x'), { recursive: true });
  await fs.mkdir(path.join(root, '.wrangler', 'state'), { recursive: true });
  await fs.mkdir(path.join(root, '.cert'), { recursive: true });
  await fs.mkdir(path.join(root, '.cache', 'j1-old-worker'), { recursive: true });
  await fs.mkdir(path.join(root, '.claude'), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<script type="module" src="/src/main.js"></script>');
  await fs.writeFile(path.join(root, 'src', 'main.js'), 'export const ready = true;');
  await fs.writeFile(path.join(root, '.dev.vars'), 'SYNTHETIC_SECRET=root');
  await fs.writeFile(path.join(root, '.dev.vars.local'), 'SYNTHETIC_SECRET=local');
  await fs.writeFile(path.join(root, 'workers', 'x', '.dev.vars'), 'SYNTHETIC_SECRET=worker');
  await fs.writeFile(path.join(root, '.wrangler', 'state', 'x'), 'SYNTHETIC_STATE=local');
  await fs.writeFile(path.join(root, '.cert', 'local-key.pem'), 'SYNTHETIC_KEY=local');
  await fs.writeFile(
    path.join(root, '.cache', 'j1-old-worker', 'worker-bundle.mjs'),
    'export const generatedWorkerBundle = true;',
  );
  await fs.writeFile(path.join(root, '.claude', 'settings.local.json'), '{"synthetic":true}');
  return root;
}

async function startVite(root) {
  const server = await createServer({
    configFile,
    root,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  runningServers.add(server);
  await server.listen();
  const address = server.httpServer.address();
  return `http://127.0.0.1:${address.port}`;
}

describe('Vite local development server security', () => {
  it('defaults the configured dev and preview hosts to loopback', async () => {
    const config = await resolveConfig({ configFile, mode: 'development' }, 'serve');
    const previewConfig = await resolveConfig({ configFile, mode: 'production' }, 'preview');

    assert.equal(config.server.host, '127.0.0.1');
    assert.equal(previewConfig.preview.host, '127.0.0.1');
  });

  it('allows an explicit LAN host through the documented environment variable', async () => {
    const previousHost = process.env.STUDYPLANNER_DEV_HOST;
    process.env.STUDYPLANNER_DEV_HOST = '0.0.0.0';

    try {
      const config = await resolveConfig({ configFile, mode: 'development' }, 'serve');
      assert.equal(config.server.host, '0.0.0.0');
      assert.equal(config.preview.host, '0.0.0.0');
    } finally {
      if (previousHost === undefined) {
        delete process.env.STUDYPLANNER_DEV_HOST;
      } else {
        process.env.STUDYPLANNER_DEV_HOST = previousHost;
      }
    }
  });

  it('prints the LAN URL from the effective host for env and CLI host paths', async () => {
    const previousLanHost = process.env.DEV_LAN_HOST;
    const previousDevelopmentHost = process.env.STUDYPLANNER_DEV_HOST;
    process.env.DEV_LAN_HOST = '192.168.1.20';
    delete process.env.STUDYPLANNER_DEV_HOST;

    try {
      const loaded = await loadConfigFromFile({ mode: 'development' }, configFile);
      const plugin = loaded.config.plugins.find((candidate) => candidate.name === 'preferred-network-url');
      const loggedUrls = [];
      const originalLog = console.log;
      console.log = (...args) => loggedUrls.push(args.join(' '));

      try {
        plugin.configureServer({
          config: {
            server: {
              ...loaded.config.server,
              host: '192.168.1.20',
              https: false,
              port: 5173,
            },
          },
          httpServer: { once: (_event, callback) => callback() },
        });
        plugin.configurePreviewServer({
          config: {
            preview: {
              ...loaded.config.preview,
              host: '0.0.0.0',
              https: false,
              port: 4173,
            },
          },
          httpServer: { once: (_event, callback) => callback() },
        });
      } finally {
        console.log = originalLog;
      }

      assert.equal(loggedUrls.length, 2);
      assert.ok(loggedUrls.every((line) => line.includes('http://192.168.1.20:')));
    } finally {
      if (previousLanHost === undefined) {
        delete process.env.DEV_LAN_HOST;
      } else {
        process.env.DEV_LAN_HOST = previousLanHost;
      }
      if (previousDevelopmentHost === undefined) {
        delete process.env.STUDYPLANNER_DEV_HOST;
      } else {
        process.env.STUDYPLANNER_DEV_HOST = previousDevelopmentHost;
      }
    }
  });

  it('blocks local secret and state files on direct and /@fs/ requests', async () => {
    const root = await createFixtureRoot();
    const origin = await startVite(root);
    const blockedFiles = [
      ['.dev.vars', '/.dev.vars'],
      ['.dev.vars.local', '/.dev.vars.local'],
      ['workers/x/.dev.vars', '/workers/x/.dev.vars'],
      ['.wrangler/state/x', '/.wrangler/state/x'],
      ['.cert/local-key.pem', '/.cert/local-key.pem'],
      ['.claude/settings.local.json', '/.claude/settings.local.json'],
    ];

    const blockedPaths = blockedFiles.flatMap(([relativePath, directPath]) => [
      directPath,
      `/@fs${path.join(root, relativePath)}`,
    ]);

    for (const requestPath of blockedPaths) {
      const response = await fetch(new URL(requestPath, origin));
      assert.ok(
        response.status === 403 || response.status === 404,
        `${requestPath} unexpectedly returned ${response.status}`,
      );
    }

    const sourceResponse = await fetch(new URL('/src/main.js', origin));
    assert.equal(sourceResponse.status, 200);
    assert.match(await sourceResponse.text(), /ready = true/);

    const generatedBundleResponse = await fetch(
      new URL('/.cache/j1-old-worker/worker-bundle.mjs', origin),
    );
    assert.equal(generatedBundleResponse.status, 200);
    assert.match(await generatedBundleResponse.text(), /generatedWorkerBundle = true/);
  });
});
