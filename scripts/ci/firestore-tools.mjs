import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../../tools/firebase-tools/node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url));

if (!existsSync(cliPath)) {
  console.error('Locked Firebase CLI is not installed. Run `npm ci --prefix tools/firebase-tools --ignore-scripts` first.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else if (result.signal) {
    console.error(`Firebase CLI terminated by ${result.signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status;
  }
}
