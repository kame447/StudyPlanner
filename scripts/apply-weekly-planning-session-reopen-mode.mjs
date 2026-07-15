import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/components/NaturalLanguageAssistant.tsx';
let source = readFileSync(path, 'utf8');

const replacements = [
  [
    `import { WeeklyPlanningConversation } from './WeeklyPlanningConversation';`,
    `import { WeeklyPlanningConversation } from './WeeklyPlanningConversation';\nimport { resolveInitialAiInputMode } from './weeklyPlanningConversationMode';`,
  ],
  [
    `  const [aiInputMode, setAiInputMode] = useState<AiInputMode>('chat');`,
    `  const [aiInputMode, setAiInputMode] = useState<AiInputMode>(() =>\n    resolveInitialAiInputMode({\n      messages: persistedWeeklyPlanningMessages,\n      intakeState: persistedWeeklyPlanningIntakeState,\n    }),\n  );`,
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
console.log('weekly planning session reopen mode applied');
