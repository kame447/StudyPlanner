import { readFileSync, writeFileSync } from 'node:fs';

function replace(path, before, after) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one anchor, got ${count}`);
  writeFileSync(path, source.replace(before, after), 'utf8');
}

replace(
  'src/features/weeklyPlanning/dialogue/weeklyPlanningKnownFixedEvents.test.ts',
  `    id,\n    userId: 'user',`,
  `    id,\n    seriesId: id,\n    userId: 'user',`,
);
replace(
  'src/features/weeklyPlanning/pipeline/weeklyPlanningFixedEventCapability.test.ts',
  `    id, userId: 'user', date, startTime: '10:00', endTime: '11:00', title: id,`,
  `    id, seriesId: id, userId: 'user', date, startTime: '10:00', endTime: '11:00', title: id,`,
);

console.log('fixed event test types adjusted');
