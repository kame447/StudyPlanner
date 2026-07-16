import { readFileSync, writeFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content, 'utf8');
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`anchor not unique in ${path}: ${before.slice(0, 120)}`);
  }
  write(path, source.slice(0, index) + after + source.slice(index + before.length));
}

const runtimePath = 'src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts';
replaceOnce(
  runtimePath,
  `  if (value.unitModel !== undefined && !STUDY_SCOPE_UNITS.has(value.unitModel as string)) return false;`,
  `  if (value.unitModel !== undefined && typeof value.unitModel !== 'string') return false;`,
);
replaceOnce(
  runtimePath,
  `        && (pending.scope.kind === 'next_week' || pending.scope.kind === 'named_future_period')\n        && typeof pending.scope.label === 'string'`,
  `        && typeof pending.scope.kind === 'string'\n        && typeof pending.scope.label === 'string'`,
);
replaceOnce(
  runtimePath,
  `        || !isRecord(pending.scope)\n        || typeof pending.sourceText !== 'string'\n        || !isOptionalPositiveInteger(pending.durationDays)) return false;`,
  `        || !isRecord(pending.scope)\n        || typeof pending.sourceText !== 'string'\n        || (pending.durationDays !== undefined\n          && (typeof pending.durationDays !== 'number' || !Number.isInteger(pending.durationDays)))) return false;`,
);

const enrichmentPath = 'src/features/weeklyPlanning/intake/weeklyPlanningExamScopeEnrichment.ts';
replaceOnce(
  enrichmentPath,
  `  error?: 'confirmed-exam-scope-attribute-overwrite';`,
  `  error?: 'confirmed-slot-overwrite';`,
);
replaceOnce(
  enrichmentPath,
  `    return { error: 'confirmed-exam-scope-attribute-overwrite' };`,
  `    return { error: 'confirmed-slot-overwrite' };`,
);
replaceOnce(
  enrichmentPath,
  `    return { error: 'confirmed-exam-scope-attribute-overwrite' };`,
  `    return { error: 'confirmed-slot-overwrite' };`,
);
replaceOnce(
  enrichmentPath,
  `    return { error: 'confirmed-exam-scope-attribute-overwrite' };`,
  `    return { error: 'confirmed-slot-overwrite' };`,
);
replaceOnce(
  enrichmentPath,
  `        rawText: uniqueList([...existing.rawText, ...incoming.rawText]),`,
  `        rawText: uniqueList([...(existing.rawText ?? []), ...incoming.rawText]),`,
);

const validatorPath = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts';
replaceOnce(
  validatorPath,
  `        addRejected(result, candidate, enrichment.error ?? 'confirmed-exam-scope-attribute-overwrite');`,
  `        addRejected(result, candidate, enrichment.error ?? 'confirmed-slot-overwrite');`,
);

const interpreterPath = 'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts';
replaceOnce(
  interpreterPath,
  `import { canonicalizeOptionalCommandNulls } from './weeklyPlanningCommandRuntimeValidation';`,
  `import {\n  canonicalizeOptionalCommandNulls,\n  isValidWeeklyPlanningCommand,\n} from './weeklyPlanningCommandRuntimeValidation';`,
);
replaceOnce(
  interpreterPath,
  `  if (!isRecord(normalizedCommand) || typeof normalizedCommand.type !== 'string') {\n    return null;\n  }\n  const wrappedNeedsConfirmation`,
  `  if (!isRecord(normalizedCommand)\n    || typeof normalizedCommand.type !== 'string'\n    || !isValidWeeklyPlanningCommand(normalizedCommand)) {\n    return null;\n  }\n  const wrappedNeedsConfirmation`,
);

const reviewTestPath = 'src/features/weeklyPlanning/intake/weeklyPlanningReviewCoreFixes.test.ts';
replaceOnce(
  reviewTestPath,
  `    expect(command.scope).toMatchObject({ ...existing, yearRange: { startYear: 2025, endYear: 2020 } });\n    const state = applyWeeklyPlanningCommands({ ...createInitialPlanningIntakeState(), examPrepScope: existing }, [command]);\n    expect(state.examPrepScope).toMatchObject({ ...existing, yearRange: { startYear: 2025, endYear: 2020 } });`,
  `    expect(command.scope).toMatchObject({\n      ...existing,\n      rawText: ['既存', '追加'],\n      yearRange: { startYear: 2025, endYear: 2020 },\n    });\n    const state = applyWeeklyPlanningCommands({ ...createInitialPlanningIntakeState(), examPrepScope: existing }, [command]);\n    expect(state.examPrepScope).toMatchObject({\n      ...existing,\n      rawText: ['既存', '追加'],\n      yearRange: { startYear: 2025, endYear: 2020 },\n    });`,
);
replaceOnce(
  reviewTestPath,
  `    expect(result.rejected[0]?.reason).toBe('confirmed-exam-scope-attribute-overwrite');`,
  `    expect(result.rejected[0]?.reason).toBe('confirmed-slot-overwrite');`,
);

const aiTestPath = 'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts';
replaceOnce(
  aiTestPath,
  `  it('keeps valid candidate units when one AI candidate has an invalid shape and defaults missing confidence to low', async () => {`,
  `  it('rejects candidate units with invalid shape or missing required confidence', async () => {`,
);
replaceOnce(
  aiTestPath,
  `    expect(result.parseRejections).toEqual([\n      { rawCandidate: { command: 'not-an-object', needsConfirmation: false }, reason: 'invalid-candidate-shape' },\n    ]);\n    expect(result.candidates).toEqual([\n      {\n        command: expect.objectContaining({\n          type: 'set_priority_policy',\n          confidence: 'low',\n        }),\n        origin: 'ai_interpreter',\n        needsConfirmation: false,\n      },\n    ]);`,
  `    expect(result.parseRejections).toEqual([\n      { rawCandidate: { command: 'not-an-object', needsConfirmation: false }, reason: 'invalid-candidate-shape' },\n      {\n        rawCandidate: {\n          command: {\n            type: 'set_priority_policy',\n            policy: { kind: 'field_first', order: ['数学', 'OS'] },\n            sourceText: '数学からOS',\n          },\n          needsConfirmation: false,\n        },\n        reason: 'invalid-candidate-shape',\n      },\n    ]);\n    expect(result.candidates).toEqual([]);`,
);
replaceOnce(
  aiTestPath,
  `  it('captures the real smoke response shape with missing confidence and invalid field-year unitModel', async () => {`,
  `  it('rejects the real smoke response when required confidence is missing', async () => {`,
);
replaceOnce(
  aiTestPath,
  `    expect(result.parseRejections).toEqual([]);\n    expect(result.candidates.map((candidate) => candidate.command.confidence)).toEqual(['low', 'low']);\n    expect(validation.rejected).toEqual([\n      expect.objectContaining({ reason: 'invalid-unit-model' }),\n    ]);\n    expect(validation.clarifications).toEqual([\n      expect.objectContaining({\n        command: expect.objectContaining({ type: 'set_priority_policy' }),\n      }),\n    ]);`,
  `    expect(result.candidates).toEqual([]);\n    expect(result.parseRejections).toHaveLength(2);\n    expect(result.parseRejections.every((item) => item.reason === 'invalid-candidate-shape')).toBe(true);\n    expect(validation.rejected).toEqual([]);\n    expect(validation.clarifications).toEqual([]);`,
);
replaceOnce(
  aiTestPath,
  `  it('shrinks invalid JSON to an empty result and defaults missing confidence in candidate-shaped data', async () => {`,
  `  it('shrinks invalid JSON and rejects candidate-shaped data missing required fields', async () => {`,
);
replaceOnce(
  aiTestPath,
  `    })).resolves.toEqual({ candidates: [expect.objectContaining({ command: expect.objectContaining({ confidence: 'low' }) })], parseRejections: [] });`,
  `    })).resolves.toEqual({\n      candidates: [],\n      parseRejections: [expect.objectContaining({ reason: 'invalid-candidate-shape' })],\n    });`,
);

console.log('weekly planning core review fixes v2 applied');
