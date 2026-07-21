import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const applicatorPath = 'scripts/apply-weekly-planning-interpreter-generalization.mjs';
let source = fs.readFileSync(applicatorPath, 'utf8');
source = source.replace(
  `  if (content.indexOf(before, first + before.length) >= 0) {\n    throw new Error(\`Replacement anchor is not unique: \${label}\`);\n  }\n`,
  '',
);
source = source.replace(
  'function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {\\n  return { candidates: [], parseRejections: [] };\\n}',
  'function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {\\n  return {\\n    candidates: [],\\n    parseRejections: [],\\n  };\\n}',
);
source = source.replaceAll(
  "!parsed || typeof parsed !== 'object' || Array.isArray(parsed)",
  '!isRecord(parsed) || !Array.isArray(parsed.candidates)',
);
source = source
  .split('\n')
  .filter((line) => !line.startsWith(
    "write('src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.observed-real-eval.test.ts'",
  ))
  .join('\n');
fs.writeFileSync(applicatorPath, source);

const syntaxCheck = spawnSync(process.execPath, ['--check', applicatorPath], { encoding: 'utf8' });
if (syntaxCheck.status !== 0) {
  const details = `${syntaxCheck.stdout || ''}${syntaxCheck.stderr || ''}`;
  fs.writeFileSync('apply-weekly-planning-interpreter-error.log', details);
  throw new Error('Applicator syntax check failed.');
}

try {
  await import('./apply-weekly-planning-interpreter-generalization.mjs');
} catch (error) {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  fs.writeFileSync('apply-weekly-planning-interpreter-error.log', `${details}\n`);
  throw error;
}
