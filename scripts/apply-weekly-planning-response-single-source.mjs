import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/components/NaturalLanguageAssistant.tsx';
let source = readFileSync(path, 'utf8');

const replacements = [
  [
    `    const message = '仮予定として追加しました。内容を確認して、承認または破棄してください。';\n    setStatus(message);\n    appendWeeklyPlanningMessage('assistant', message);`,
    `    const message = '仮予定として追加しました。内容を確認して、承認または破棄してください。';\n    setStatus('');\n    appendWeeklyPlanningMessage('assistant', message);`,
  ],
  [
    `      const message = \`\${pendingWeeklyDraftBlocks.length}件の仮予定を通常予定として保存しました。\`;\n      setStatus(message);\n      appendWeeklyPlanningMessage('assistant', message);`,
    `      const message = \`\${pendingWeeklyDraftBlocks.length}件の仮予定を通常予定として保存しました。\`;\n      setStatus('');\n      appendWeeklyPlanningMessage('assistant', message);`,
  ],
];

for (const [before, after] of replacements) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found: ${before}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`anchor is not unique: ${before}`);
  }
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

writeFileSync(path, source, 'utf8');
