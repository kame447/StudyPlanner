import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`anchor not found in ${path}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`anchor not unique in ${path}`);
  writeFileSync(path, source.slice(0, index) + after + source.slice(index + before.length), 'utf8');
}

const runtimePath = 'src/features/weeklyPlanning/intake/weeklyPlanningCommandRuntimeValidation.ts';
replaceOnce(
  runtimePath,
  `    && typeof command.sourceText === 'string'\n    && isOptionalString(command.sourceSegment);`,
  `    && typeof command.sourceText === 'string'\n    && command.sourceText.length <= 4000\n    && isOptionalString(command.sourceSegment);`,
);
replaceOnce(
  runtimePath,
  `    && isNonEmptyString(goal.title)\n    && isOptionalString(goal.subject)\n    && (goal.unit === undefined || STUDY_SCOPE_UNITS.has(goal.unit as string))`,
  `    && isNonEmptyString(goal.title)\n    && goal.title.length <= 200\n    && isOptionalString(goal.subject)\n    && (goal.unit === undefined || typeof goal.unit === 'string')`,
);

console.log('weekly planning core review fixes v4 applied');
