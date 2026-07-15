import { readFileSync, writeFileSync } from 'node:fs';

function replaceInFile(path, before, after, options = {}) {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(before)) {
    if (options.optional) return;
    throw new Error(`test update target not found: ${path}\n${before}`);
  }
  const next = options.all ? source.split(before).join(after) : source.replace(before, after);
  writeFileSync(path, next, 'utf8');
}

const genericFixedEventQuestion =
  'すでに登録した予定以外に、時間が決まっていて動かせない予定はありますか？';

for (const path of [
  'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
  'src/features/weeklyPlanning/dialogue/weeklyPlanningAiDialogueRenderer.test.ts',
]) {
  replaceInFile(
    path,
    '固定予定はありますか？',
    genericFixedEventQuestion,
    { all: true, optional: true },
  );
  replaceInFile(
    path,
    '授業・バイト・通院など、動かせない予定があれば教えてください。',
    genericFixedEventQuestion,
    { all: true, optional: true },
  );
  replaceInFile(
    path,
    '授業・バイト・通院など動かせない予定',
    '時間が決まっていて動かせない予定',
    { all: true, optional: true },
  );
}

replaceInFile(
  'src/features/weeklyPlanning/__tests__/weeklyPlanningClarificationContext.test.ts',
  '月曜日の18時から20時はバイトです',
  '土曜日の14時から16時は予定があります',
  { all: true },
);

replaceInFile(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueMessages.test.ts',
  ".toContain('固定予定')",
  ".toContain('時間が決まっていて動かせない予定')",
);

replaceInFile(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts',
  `    expect(output.interpreterDiagnostics?.accepted).toEqual([\n      expect.objectContaining({ type: 'set_priority_policy' }),\n    ]);`,
  `    expect(output.interpreterDiagnostics?.accepted).toEqual([]);\n    expect(output.state.missing).not.toContain('priority_policy');`,
);

replaceInFile(
  'src/features/weeklyPlanning/weeklyPlanningConversationPersistence.test.ts',
  `describe('weekly planning conversation persistence', () => {\n  beforeEach(() => window.localStorage.clear());`,
  `const storedValues = new Map<string, string>();\nconst localStorageMock = {\n  getItem: (key: string) => storedValues.get(key) ?? null,\n  setItem: (key: string, value: string) => { storedValues.set(key, value); },\n  removeItem: (key: string) => { storedValues.delete(key); },\n  clear: () => { storedValues.clear(); },\n  key: (index: number) => Array.from(storedValues.keys())[index] ?? null,\n  get length() { return storedValues.size; },\n} as Storage;\n\nObject.defineProperty(globalThis, 'window', {\n  configurable: true,\n  value: { localStorage: localStorageMock },\n});\n\ndescribe('weekly planning conversation persistence', () => {\n  beforeEach(() => storedValues.clear());`,
);

replaceInFile(
  'src/components/NaturalLanguageAssistant.tsx',
  `  function clearWeeklyPlanningDrafts() {\n    onClearWeeklyDraftBlocks?.();\n    resetWeeklyPlanningSession();\n  }\n\n`,
  '',
);

replaceInFile(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  '    knownFixedEventSummaries: string[];',
  '    knownFixedEventSummaries?: string[];',
);

replaceInFile(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.ts',
  '  const summaries = input.acceptedFacts.knownFixedEventSummaries;',
  '  const summaries = input.acceptedFacts.knownFixedEventSummaries ?? [];',
);
