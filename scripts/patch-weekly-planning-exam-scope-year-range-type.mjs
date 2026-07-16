import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/features/weeklyPlanning/intake/weeklyPlanningExamScopeEnrichment.ts';
let source = readFileSync(path, 'utf8');
const before = `function sameYearRange(\n  left: ExamPrepScope['yearRange'],\n  right: ExamPrepScope['yearRange'],\n): boolean {`;
const after = `function sameYearRange(\n  left: { startYear: number; endYear: number; sourceText?: string } | undefined,\n  right: { startYear: number; endYear: number; sourceText?: string } | undefined,\n): boolean {`;
if (!source.includes(before)) throw new Error('year range signature anchor not found');
source = source.replace(before, after);
writeFileSync(path, source, 'utf8');
console.log('weekly planning exam scope year range type applied');
