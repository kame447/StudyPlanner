import fs from 'node:fs';
import path from 'node:path';
import { withIsolatedMutationTools } from './isolated-mutation-toolchain.mjs';

if (process.argv[2] === '--partition') {
  const { runPartitionCommand } = await import('./run-mutation-partition.mjs');
  await runPartitionCommand(process.argv.slice(3));
} else {
  await withIsolatedMutationTools(({ directory, run }) => {
    const coreDirectory = path.join(directory, 'node_modules/@stryker-mutator/core');
    const core = JSON.parse(fs.readFileSync(path.join(coreDirectory, 'package.json'), 'utf8'));
    run(path.join(coreDirectory, core.bin.stryker), ['run', process.argv[2] ?? 'stryker.config.mjs']);
  });
}
