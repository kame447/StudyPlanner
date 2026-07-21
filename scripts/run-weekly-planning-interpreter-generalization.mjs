import fs from 'node:fs';

const applicatorPath = 'scripts/apply-weekly-planning-interpreter-generalization.mjs';
let source = fs.readFileSync(applicatorPath, 'utf8');
source = source.replace(
  `  if (content.indexOf(before, first + before.length) >= 0) {\n    throw new Error(\`Replacement anchor is not unique: \${label}\`);\n  }\n`,
  '',
);
fs.writeFileSync(applicatorPath, source);
await import('./apply-weekly-planning-interpreter-generalization.mjs');
