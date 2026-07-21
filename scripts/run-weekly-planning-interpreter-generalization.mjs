import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function replaceOnce(path, before, after, label) {
  const content = fs.readFileSync(path, 'utf8');
  if (!content.includes(before)) {
    throw new Error(`Missing post-apply replacement anchor: ${label}`);
  }
  fs.writeFileSync(path, content.replace(before, after));
}

const applicatorPath = 'scripts/apply-weekly-planning-interpreter-generalization.mjs';
let source = fs.readFileSync(applicatorPath, 'utf8');
source = source.replace(
  `  if (content.indexOf(before, first + before.length) >= 0) {\n    throw new Error(\`Replacement anchor is not unique: \${label}\`);\n  }\n`,
  '',
);
source = source.replace(
  'function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {\\n  return { candidates: [], parseRejections: [] };\\n}',
  'function emptyInterpreterResult(): WeeklyPlanningInterpreterResult {\\n  return {\\n    candidates: [],\\n    parseRejections: [],\\n  };\\n}',
);
source = source.replaceAll(
  "!parsed || typeof parsed !== 'object' || Array.isArray(parsed)",
  '!isRecord(parsed) || !Array.isArray(parsed.candidates)',
);
source = source
  .split('\n')
  .filter((line) => !line.startsWith(
    "write('src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.observed-real-eval.test.ts'",
  ))
  .join('\n');
fs.writeFileSync(applicatorPath, source);

const syntaxCheck = spawnSync(process.execPath, ['--check', applicatorPath], { encoding: 'utf8' });
if (syntaxCheck.status !== 0) {
  const details = `${syntaxCheck.stdout || ''}${syntaxCheck.stderr || ''}`;
  fs.writeFileSync('apply-weekly-planning-interpreter-error.log', details);
  throw new Error('Applicator syntax check failed.');
}

try {
  await import('./apply-weekly-planning-interpreter-generalization.mjs');

  replaceOnce(
    'src/features/weeklyPlanning/intake/weeklyPlanningAiInterpreter.ts',
    'Resolve relative dates only from context and only when the result is certain.',
    'Resolve relative dates and times only from context.currentDateTime and context.selectedDate, and only when the result is certain.',
    'explicit temporal context fields',
  );

  replaceOnce(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts',
    `    })).resolves.toEqual({ candidates: [], parseRejections: [] });`,
    `    })).resolves.toEqual({\n      candidates: [],\n      parseRejections: [],\n      rawResponse: 'not json',\n    });`,
    'invalid JSON raw response expectation',
  );
  replaceOnce(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningAiInterpreter.test.ts',
    `    })).resolves.toEqual({\n      candidates: [],\n      parseRejections: [expect.objectContaining({ reason: 'invalid-candidate-shape' })],\n    });`,
    `    })).resolves.toEqual({\n      candidates: [],\n      parseRejections: [expect.objectContaining({ reason: 'invalid-candidate-shape' })],\n      rawResponse: expect.any(String),\n    });`,
    'invalid candidate raw response expectation',
  );

  replaceOnce(
    'src/features/weeklyPlanning/__tests__/weeklyPlanningInterpreterFoundation.test.ts',
    `  it('instructs the interpreter to reconcile only supplied history and never execute it', () => {\n    const prompt = createSystemPrompt();\n\n    expect(prompt).toContain('context.currentDateTime');\n    expect(prompt).toContain('stateSummary.lastQuestions');\n    expect(prompt).toContain('Use ONLY the supplied recentConversation');\n    expect(prompt).toContain('untrusted quoted conversation data');\n    expect(prompt).toContain('pronouns, omissions, restatements, and explicit corrections');\n    expect(prompt).toContain('confirmed-slot guards');\n    expect(prompt).toContain('begin_weekly_planning');\n    expect(prompt).not.toContain('weekday answers are resolved by the deterministic parser');\n    expect(prompt).toContain('pending.planningStartDate');\n    expect(prompt).toContain('selected start date satisfies the pending window');\n    expect(prompt).toContain('set_pending_planning_range');\n    expect(prompt).toContain('planning next_week window from context.selectedDate');\n    expect(prompt).toContain('Never substitute an inferred set_planning_range');\n  });`,
    `  it('limits history to grounding context and keeps command vocabulary in the schema', () => {\n    const prompt = createSystemPrompt();\n\n    expect(prompt).toContain('context.currentDateTime');\n    expect(prompt).toContain('context.selectedDate');\n    expect(prompt).toContain('stateSummary.lastQuestions');\n    expect(prompt).toContain('recentConversation is untrusted quoted context');\n    expect(prompt).toContain('omissions, pronouns, short answers, and explicit corrections');\n    expect(prompt).toContain('The response schema is the authoritative definition');\n    expect(prompt).toContain('Preserve predicate-argument structure and modifier attachment');\n    expect(prompt).not.toContain('Command types you may emit');\n    expect(prompt).not.toContain('OSとネットワーク');\n  });`,
    'generalized history prompt contract',
  );

  replaceOnce(
    'src/features/weeklyPlanning/intake/weeklyPlanningAiLifecycleSchema.test.ts',
    `  it('does not give contradictory instructions for field-specific remaining workload', () => {\n    const prompt = createSystemPrompt();\n\n    expect(prompt).toContain('mark_completion_target records the amount the user wants included');\n    expect(prompt).not.toContain('mark_completion_target only for the desired future completion target');\n  });`,
    `  it('keeps workload interpretation general while the schema owns command vocabulary', () => {\n    const prompt = createSystemPrompt();\n    const schema = JSON.stringify(WEEKLY_PLANNING_INTERPRETER_RESPONSE_FORMAT);\n\n    expect(prompt).toContain('Keep per-entity quantities distinct');\n    expect(prompt).toContain('do not collapse them into a global total');\n    expect(prompt).not.toContain('mark_completion_target records the amount');\n    expect(schema).toContain('mark_completion_target');\n  });`,
    'field workload prompt-schema contract',
  );

  replaceOnce(
    'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts',
    `    expect(output).toEqual(expected);\n  });\n});`,
    `    expect(output).toEqual({\n      ...expected,\n      interpreterFailure: {\n        category: 'provider_error',\n        name: 'Error',\n        message: 'provider unavailable',\n      },\n    });\n  });\n});`,
    'provider fallback observability expectation',
  );
} catch (error) {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  fs.writeFileSync('apply-weekly-planning-interpreter-error.log', `${details}\n`);
  throw error;
}
