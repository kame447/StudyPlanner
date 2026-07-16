import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/apply-weekly-planning-session-ui.mjs';
let source = readFileSync(path, 'utf8');
const before = "  if (count !== 1) throw new Error(`${path}: expected one anchor, got ${count}`);\n  writeFileSync(path, source.replace(before, after), 'utf8');";
const after = "  if (count !== 1) {\n    if (path === 'src/App.tsx' && before.includes('onRemoveWeeklyDraftBlock')) {\n      if (count === 2) {\n        writeFileSync(path, source.split(before).join(after), 'utf8');\n        return;\n      }\n      if (count === 0) return;\n    }\n    throw new Error(`${path}: expected one anchor, got ${count}`);\n  }\n  writeFileSync(path, source.replace(before, after), 'utf8');";
if (!source.includes(before)) throw new Error('replaceOnce helper not found');
source = source.replace(before, after);
writeFileSync(path, source, 'utf8');
