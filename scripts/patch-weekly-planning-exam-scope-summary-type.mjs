import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found in ${path}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`anchor not unique in ${path}`);
  writeFileSync(path, source.slice(0, index) + after + source.slice(index + before.length), 'utf8');
}

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningInterpreterTypes.ts',
  `  examScopeSummary?: ExamPrepScope;`,
  `  examScopeSummary?: Omit<Partial<ExamPrepScope>, 'fields' | 'yearRange'> & {\n    fields: string[];\n    rawText?: string[];\n    yearRange?: { startYear: number; endYear: number; sourceText?: string };\n  };`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningExamScopeEnrichment.ts',
  `  existing: ExamPrepScope | undefined,`,
  `  existing: (Omit<Partial<ExamPrepScope>, 'fields' | 'yearRange'> & {\n    fields: string[];\n    rawText?: string[];\n    yearRange?: { startYear: number; endYear: number; sourceText?: string };\n  }) | undefined,`,
);

console.log('weekly planning exam scope summary type applied');
