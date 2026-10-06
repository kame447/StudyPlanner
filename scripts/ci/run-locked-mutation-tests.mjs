import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { snapshotLockedToolchain, verifyLockedToolchain } from './locked-test-toolchain.mjs';

const root = process.cwd();
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) {
  throw new Error('Run through npm run test:mutation:weekly-planning so the npm CLI is known');
}
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const version = name => {
  const result = lock.packages?.['node_modules/' + name]?.version;
  if (typeof result !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(result)) {
    throw new Error('Missing exact locked version for ' + name);
  }
  return result;
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const resolvedPool = prefix => {
  const fromVitest = createRequire(path.join(prefix, 'node_modules/vitest/package.json'));
  const poolFile = fs.realpathSync(fromVitest.resolve('tinypool/package.json'));
  const modulesRoot = fs.realpathSync(path.join(prefix, 'node_modules'));
  if (!poolFile.startsWith(modulesRoot + path.sep)) throw new Error('Tinypool resolved outside the tool installation');
  const version = JSON.parse(fs.readFileSync(poolFile, 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    throw new Error('Missing exact resolved tinypool version');
  }
  return {
    version,
    lockKey: 'node_modules/' + path.relative(modulesRoot, path.dirname(poolFile)).split(path.sep).join('/'),
  };
};
const vitestVersion = version('vitest');
const rootPool = resolvedPool(root);
const verifyRootPool = () => {
  const current = resolvedPool(root);
  if (lock.packages?.[current.lockKey]?.version !== current.version
    || current.lockKey !== rootPool.lockKey || current.version !== rootPool.version) {
    throw new Error('Root resolved tinypool is not locked or changed');
  }
};
verifyRootPool();
const tinypoolVersion = rootPool.version;
const typescriptVersion = version('typescript');
const before = snapshotLockedToolchain(root);
const manifestPaths = ['package.json', 'package-lock.json'];
const manifests = manifestPaths.map(file => fs.readFileSync(path.join(root, file)));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studyplanner-mutation-tools-'));
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Mutation tool command failed: ' + (result.status ?? result.signal));
};

try {
  // npm exec can omit explicitly requested packages already available locally;
  // peers in its cache may then resolve to a different compiler/test runner.
  // Install all requested versions into an empty, separate prefix instead.
  // The temporary installation must honor the application's security overrides.
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: 'studyplanner-mutation-tools', private: true, overrides: manifest.overrides ?? {},
  }));
  run(npmCli, [
    'install', '--prefix', directory, '--no-save', '--no-audit', '--no-fund',
    '@stryker-mutator/core@9.6.1',
    '@stryker-mutator/vitest-runner@9.6.1',
    '@stryker-mutator/typescript-checker@9.6.1',
    'vitest@' + vitestVersion, 'typescript@' + typescriptVersion,
  ]);
  for (const [name, expected] of [['vitest', vitestVersion], ['typescript', typescriptVersion]]) {
    const actual = JSON.parse(fs.readFileSync(path.join(directory, 'node_modules', name, 'package.json'), 'utf8')).version;
    if (actual !== expected) throw new Error('Isolated ' + name + ' version mismatch');
    console.log('Isolated ' + name + ': ' + actual);
  }
  const isolatedPoolVersion = resolvedPool(directory).version;
  if (isolatedPoolVersion !== tinypoolVersion) throw new Error('Isolated tinypool version mismatch');
  console.log('Isolated tinypool resolved from Vitest: ' + isolatedPoolVersion);
  verifyRootPool();
  verifyLockedToolchain(root, before);
  const coreDirectory = path.join(directory, 'node_modules/@stryker-mutator/core');
  const core = JSON.parse(fs.readFileSync(path.join(coreDirectory, 'package.json'), 'utf8'));
  run(path.join(coreDirectory, core.bin.stryker), ['run', process.argv[2] ?? 'stryker.config.mjs']);
} finally {
  try {
    verifyRootPool();
    verifyLockedToolchain(root, before);
    for (let index = 0; index < manifestPaths.length; index++) {
      if (!fs.readFileSync(path.join(root, manifestPaths[index])).equals(manifests[index])) {
        throw new Error('Mutation tools changed ' + manifestPaths[index]);
      }
    }
  } finally {
    // Only remove the temporary tool installation created by this invocation.
    // Stryker reports and failure evidence in the project remain intact.
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
