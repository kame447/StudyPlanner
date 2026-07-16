import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, content) { writeFileSync(path, content, 'utf8'); }
function replaceOnce(path, before, after) {
  const source = read(path);
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`anchor not unique in ${path}`);
  write(path, source.slice(0, index) + after + source.slice(index + before.length));
}

const enrichmentPath = 'src/features/weeklyPlanning/intake/weeklyPlanningExamScopeEnrichment.ts';
replaceOnce(
  enrichmentPath,
  `  return {\n    command: {\n      ...command,\n      scope: {\n        examType: existing.examType ?? incoming.examType,\n        fields: existing.fields.length > 0 ? [...existing.fields] : [...incoming.fields],\n        totalFields: existing.totalFields ?? incoming.totalFields,\n        totalYears: existing.totalYears ?? incoming.totalYears,\n        yearRange: existing.yearRange ?? incoming.yearRange,\n        strategyHint: existing.strategyHint ?? incoming.strategyHint,\n        unitModel: existing.unitModel ?? incoming.unitModel,\n        unitCountHint: existing.unitCountHint ?? incoming.unitCountHint,\n        rawText: uniqueList([...(existing.rawText ?? []), ...incoming.rawText]),\n      },\n    },\n  };`,
  `  const examType = existing.examType ?? incoming.examType;\n  const totalFields = existing.totalFields ?? incoming.totalFields;\n  const totalYears = existing.totalYears ?? incoming.totalYears;\n  const strategyHint = existing.strategyHint ?? incoming.strategyHint;\n  const unitModel = existing.unitModel ?? incoming.unitModel;\n  const unitCountHint = existing.unitCountHint ?? incoming.unitCountHint;\n  const yearRange = existing.yearRange\n    ? {\n        ...existing.yearRange,\n        sourceText: existing.yearRange.sourceText ?? incoming.yearRange?.sourceText ?? '',\n      }\n    : incoming.yearRange;\n\n  return {\n    command: {\n      ...command,\n      scope: {\n        ...(examType !== undefined ? { examType } : {}),\n        fields: existing.fields.length > 0 ? [...existing.fields] : [...incoming.fields],\n        ...(totalFields !== undefined ? { totalFields } : {}),\n        ...(totalYears !== undefined ? { totalYears } : {}),\n        ...(yearRange ? { yearRange } : {}),\n        ...(strategyHint !== undefined ? { strategyHint } : {}),\n        ...(unitModel !== undefined ? { unitModel } : {}),\n        ...(unitCountHint !== undefined ? { unitCountHint } : {}),\n        rawText: uniqueList([...(existing.rawText ?? []), ...incoming.rawText]),\n      },\n    },\n  };`,
);

const aiTestPath = 'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts';
replaceOnce(
  aiTestPath,
  `    expect(validation.acceptedWithConfirmation).toEqual([\n      expect.objectContaining({ type: 'set_study_goal' }),\n    ]);\n    expect(validation.rejected).toEqual([\n      expect.objectContaining({ reason: 'invalid-command-shape' }),\n    ]);`,
  `    expect(validation.acceptedWithConfirmation).toEqual([\n      expect.objectContaining({ type: 'set_study_goal' }),\n    ]);\n    expect(validation.rejected).toEqual([]);\n    expect(result.parseRejections).toEqual([\n      expect.objectContaining({ reason: 'invalid-candidate-shape' }),\n    ]);`,
);

console.log('weekly planning core review fixes v3 applied');
