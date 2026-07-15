import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/apply-weekly-planning-conversation-hardening.mjs';
let source = readFileSync(path, 'utf8');

const replacements = [
  ['${Number(month)}', '\\${Number(month)}'],
  ['${formatDate(plan.date)}', '\\${formatDate(plan.date)}'],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    throw new Error(`apply script patch target not found: ${before}`);
  }
  source = source.replace(before, after);
}

writeFileSync(path, source, 'utf8');
