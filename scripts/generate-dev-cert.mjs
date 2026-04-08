import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const certDirectory = path.join(projectRoot, '.cert');
const certFilePath = path.join(certDirectory, 'study-planner-local.pem');
const keyFilePath = path.join(certDirectory, 'study-planner-local-key.pem');

const additionalHosts = process.argv.slice(2).map((host) => host.trim()).filter(Boolean);
const defaultHosts = [
  'localhost',
  '127.0.0.1',
  os.hostname(),
  `${os.hostname()}.local`,
];
const hosts = [...new Set([...defaultHosts, ...additionalHosts])];

function resolveMkcertExecutable() {
  const pathDirectories = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean);
  const candidateDirectories = [
    ...pathDirectories,
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Microsoft',
      'WinGet',
      'Packages',
      'FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe',
    ),
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'mkcert'),
  ];

  const candidateNames =
    process.platform === 'win32' ? ['mkcert.exe', 'mkcert.cmd', 'mkcert.bat'] : ['mkcert'];

  for (const directory of candidateDirectories) {
    if (!directory) {
      continue;
    }

    for (const candidateName of candidateNames) {
      const candidatePath = path.join(directory, candidateName);

      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return 'mkcert';
}

const mkcertExecutable = resolveMkcertExecutable();

function runMkcert(args, extraEnv = {}) {
  const result = spawnSync(mkcertExecutable, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`mkcert failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

if (!fs.existsSync(certDirectory)) {
  fs.mkdirSync(certDirectory, { recursive: true });
}

try {
  runMkcert(['-install'], { TRUST_STORES: 'system' });
  runMkcert(['-cert-file', certFilePath, '-key-file', keyFilePath, ...hosts]);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('証明書の生成に失敗しました。mkcert が PATH にあるか確認してください。');
  console.error(message);
  process.exit(1);
}

console.log('証明書を生成しました:');
console.log(`  Cert: ${certFilePath}`);
console.log(`  Key : ${keyFilePath}`);
console.log('ホスト名:');
for (const host of hosts) {
  console.log(`  - ${host}`);
}
