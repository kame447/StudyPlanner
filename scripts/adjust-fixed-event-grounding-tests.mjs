import { readFileSync, writeFileSync } from 'node:fs';

function replace(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one anchor, got ${count}`);
  writeFileSync(path, source.replace(before, after), 'utf8');
}

replace(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningBehaviorAwareDialoguePlanner.test.ts',
  `    const value = rangeOnlyState();\n    value.missing = ['fixed_events'];`,
  `    const value = state(['英語ワークを進めたい']);\n    value.fixedEventsDeclaredNone = undefined;\n    value.missing = ['fixed_events'];`,
);

replace(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningFixedEventCapability.test.ts',
  `    const recurring = { ...plan('weekly', '2026-07-09'), repeat: 'weekly' as const, repeatUntil: '2026-08-31' };`,
  `    const recurring = {\n      ...plan('weekly', '2026-07-09'),\n      startTime: '14:00',\n      endTime: '15:00',\n      repeat: 'weekly' as const,\n      repeatUntil: '2026-08-31',\n    };`,
);

const path = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.test.ts';
let source = readFileSync(path, 'utf8');
const oldFixture = `existingPlans: [plan({ date: '2026-06-30' })]`;
const count = source.split(oldFixture).length - 1;
if (count !== 3) throw new Error(`expected three fixtures, got ${count}`);
source = source.split(oldFixture).join(`existingPlans: [plan({ date: '2026-06-27' })]`);
writeFileSync(path, source, 'utf8');

console.log('fixed event tests adjusted');
