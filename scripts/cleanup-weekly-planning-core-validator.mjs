import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts';
let source = readFileSync(path, 'utf8');

function cut(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`anchor not found: ${startMarker}`);
  source = source.slice(0, start) + source.slice(end);
}

cut('const SET_STUDY_GOAL_TEXT_LIMITS = {', 'const MERGE_MODES');
cut('function isPlainRecord', 'function isTime');
cut('function hasRequiredShape', 'function validateEnumVocabulary');
cut('function sameStringSet', 'function addRejected');

const unusedSlots = `    const confirmedOverlaps = slots.filter((slot) => summary.confirmedSlots.includes(slot));\n    const unconfirmedSlots = slots.filter((slot) => !summary.confirmedSlots.includes(slot));`;
if (!source.includes(unusedSlots)) throw new Error('slot anchor not found');
source = source.replace(
  unusedSlots,
  `    const confirmedOverlaps = slots.filter((slot) => summary.confirmedSlots.includes(slot));`,
);

writeFileSync(path, source, 'utf8');
console.log('weekly planning validator cleanup applied');
