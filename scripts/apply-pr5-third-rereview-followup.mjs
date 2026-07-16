import fs from 'node:fs';

const path = 'src/features/weeklyPlanning/intake/weeklyPlanningScopeParsing.ts';
const before = `function parseWeekdayStart(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/([月火水木金土日])(?:曜(?:日)?)?\\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}
`;
const after = `function parseWeekdayStart(text: string): number | undefined {
  const match = normalizeIntakeText(text).match(/(?:^|[^0-9])([月火水木金土日])(?:曜(?:日)?)?\\s*から/);
  return match ? WEEKDAY_INDEX[match[1]] : undefined;
}
`;
const content = fs.readFileSync(path, 'utf8');
if (!content.includes(before)) {
  throw new Error('Missing weekday parser target');
}
fs.writeFileSync(path, content.replace(before, after));
