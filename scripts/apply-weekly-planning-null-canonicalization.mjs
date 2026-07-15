import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found: ${path}\n${before}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`anchor is not unique: ${path}\n${before}`);
  }
  writeFileSync(path, source.slice(0, index) + after + source.slice(index + before.length), 'utf8');
}

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
  `function isRecord(value: unknown): value is Record<string, unknown> {\n  return typeof value === 'object' && value !== null;\n}\n\nfunction normalizeConfidence`,
  `function isRecord(value: unknown): value is Record<string, unknown> {\n  return typeof value === 'object' && value !== null;\n}\n\nfunction omitNullObjectProperties(value: unknown): unknown {\n  if (Array.isArray(value)) {\n    return value.map((item) => omitNullObjectProperties(item));\n  }\n  if (!isRecord(value)) {\n    return value;\n  }\n\n  return Object.fromEntries(\n    Object.entries(value)\n      .filter(([, propertyValue]) => propertyValue !== null)\n      .map(([key, propertyValue]) => [key, omitNullObjectProperties(propertyValue)]),\n  );\n}\n\nfunction normalizeConfidence`,
);

replaceOnce(
  'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
  `  const command = isRecord(candidate.command) ? candidate.command : candidate;\n  if (typeof command.type !== 'string') {\n    return null;\n  }`,
  `  const rawCommand = isRecord(candidate.command) ? candidate.command : candidate;\n  const normalizedCommand = omitNullObjectProperties(rawCommand);\n  if (!isRecord(normalizedCommand) || typeof normalizedCommand.type !== 'string') {\n    return null;\n  }\n  const command = normalizedCommand;`,
);

replaceOnce(
  'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts',
  `  it('defines a closed command schema for every known command type', () => {`,
  `  it('treats null object properties as unspecified without repairing required fields', async () => {\n    const interpreter = createAiWeeklyPlanningInterpreter(config, createMockClient(JSON.stringify({\n      candidates: [\n        {\n          command: {\n            type: 'set_study_goal',\n            goal: {\n              title: '全体を先におさらいする',\n              subject: '院試全体',\n              unit: 'unknown',\n              amount: null,\n            },\n            sourceText: '全体を先におさらいしたい',\n            confidence: 'medium',\n          },\n        },\n        {\n          command: {\n            type: 'set_study_goal',\n            goal: { title: null, amount: null },\n            sourceText: '壊れた必須項目',\n            confidence: 'high',\n          },\n        },\n      ],\n    })));\n\n    const result = await interpreter.interpretUserTurn({\n      userText: '全体を先におさらいしたい',\n      context: { selectedDate: '2030-01-01', planningDayCount: 7 },\n      stateSummary: { knownFields: [], confirmedSlots: [] },\n    });\n    const validation = validateInterpretedCandidates(\n      result.candidates,\n      { knownFields: [], confirmedSlots: [] },\n    );\n\n    expect(result.candidates[0]?.command).toEqual(expect.objectContaining({\n      type: 'set_study_goal',\n      goal: {\n        title: '全体を先におさらいする',\n        subject: '院試全体',\n        unit: 'unknown',\n      },\n    }));\n    expect(validation.acceptedWithConfirmation).toEqual([\n      expect.objectContaining({ type: 'set_study_goal' }),\n    ]);\n    expect(validation.rejected).toEqual([\n      expect.objectContaining({ reason: 'invalid-command-shape' }),\n    ]);\n  });\n\n  it('defines a closed command schema for every known command type', () => {`,
);

console.log('weekly planning null canonicalization applied');
