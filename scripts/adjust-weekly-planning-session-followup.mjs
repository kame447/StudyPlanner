import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/apply-weekly-planning-session-followup.mjs';
let source = readFileSync(path, 'utf8');
const before = `replaceOnce(
  'src/components/QuickEntryModal.tsx',
  \`scheduleTemplates={scheduleTemplates}\\n                 timetableTermId={timetableTermId}\\n                 onApplyDraft={onSavePlan}\`,
  \`onApplyDraft={onSavePlan}\`,
);`;
const after = `{
  const path = 'src/components/QuickEntryModal.tsx';
  const source = readFileSync(path, 'utf8');
  const pattern = /[ \\t]*scheduleTemplates=\\{scheduleTemplates\\}\\n[ \\t]*timetableTermId=\\{timetableTermId\\}\\n/;
  if (!pattern.test(source)) throw new Error('QuickEntry schedule bridge anchor not found');
  writeFileSync(path, source.replace(pattern, ''), 'utf8');
}`;
if (!source.includes(before)) throw new Error('followup QuickEntry anchor block not found');
source = source.replace(before, after);
writeFileSync(path, source, 'utf8');
