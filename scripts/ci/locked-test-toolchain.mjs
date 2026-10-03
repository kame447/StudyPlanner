import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function packageFile(root, packagePath) {
  if (!packagePath.startsWith('node_modules/') || packagePath.split('/').includes('..')) {
    throw new Error('Invalid locked package path: ' + packagePath);
  }
  return path.join(root, packagePath, 'package.json');
}

export function snapshotLockedToolchain(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const installed = {};
  for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
    if (!packagePath || !entry.version) continue;
    const file = packageFile(root, packagePath);
    // npm ci legitimately omits optional packages for other OS/CPU platforms.
    if (!fs.existsSync(file)) {
      if (entry.optional || entry.devOptional) continue;
      throw new Error('Required locked package missing: ' + packagePath + '; run npm ci first');
    }
    const actual = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    if (actual !== entry.version) {
      throw new Error(packagePath + ': lock=' + entry.version + ', installed=' + actual);
    }
    installed[packagePath] = entry.version;
  }
  if (Object.keys(installed).length === 0) throw new Error('No installed locked packages; run npm ci first');
  return { version: 1, installed };
}

export function verifyLockedToolchain(root, snapshot) {
  if (snapshot?.version !== 1 || !snapshot.installed
    || Object.keys(snapshot.installed).length === 0) throw new Error('Invalid toolchain snapshot');
  for (const [packagePath, expected] of Object.entries(snapshot.installed)) {
    const file = packageFile(root, packagePath);
    if (!fs.existsSync(file)) throw new Error('Locked package disappeared: ' + packagePath);
    const actual = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    if (actual !== expected) {
      throw new Error(packagePath + ': before=' + expected + ', after=' + actual);
    }
  }
  return Object.keys(snapshot.installed).length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, snapshotFile] = process.argv.slice(2);
  if (!snapshotFile || !['snapshot', 'verify'].includes(command)) {
    throw new Error('Usage: node scripts/ci/locked-test-toolchain.mjs snapshot|verify <file>');
  }
  if (command === 'snapshot') {
    const snapshot = snapshotLockedToolchain(process.cwd());
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2) + '\n');
    console.log('Recorded ' + Object.keys(snapshot.installed).length + ' installed locked packages');
  } else {
    const count = verifyLockedToolchain(process.cwd(), JSON.parse(fs.readFileSync(snapshotFile, 'utf8')));
    console.log('Verified ' + count + ' installed locked package versions are unchanged');
  }
}
