import { expect, it } from 'vitest';
import { requireCurrentTimetableImportTemplates } from './timetableImportAdmission';
import { buildTimetableImportCandidates, createPlanDraftFromTimetableImportCandidate } from '../lib/timetableImport';
import type { ScheduleTemplate, TimetableTerm } from '../types/domain';

const stamp = '2026-10-01T00:00:00Z', date = '2026-10-05';
const term: TimetableTerm = { id: 'term', userId: 'owner', year: 2026, kind: 'custom', label: 'Term',
  isActive: true, startDate: '2026-10-01', endDate: '2026-10-31', createdAt: stamp, updatedAt: stamp };
const templates: ScheduleTemplate[] = [1, 2].map(period => ({ id: `class-${period}`, userId: 'owner', title: 'Class',
  subject: 'Math', type: 'school-event', weekday: 'mon', termId: term.id, periodNumber: period, active: true,
  startTime: `${period + 12}:00`, endTime: `${period + 13}:00`, memo: '', createdAt: stamp, updatedAt: stamp }));
const candidate = buildTimetableImportCandidates({ templates, date, weekday: 'mon', termId: term.id, term })[0];
const draft = createPlanDraftFromTimetableImportCandidate(candidate, 'owner', date);

it('returns every current grouped source for admission', () => {
  expect(requireCurrentTimetableImportTemplates('owner', draft, templates, [term])).toEqual(templates);
});
it.each(['excluded', 'removed', 'foreign', 'renamed', 'rescheduled'] as const)('rejects stale grouped source: %s', change => {
  const changed = change === 'removed' ? templates.slice(1) : templates.map(row => row.id !== 'class-1' ? row : {
    ...row, ...(change === 'excluded' ? { excludedDates: [date] } : change === 'foreign' ? { userId: 'other' }
      : change === 'renamed' ? { title: 'New title' } : { startTime: '12:30' }),
  });
  expect(() => requireCurrentTimetableImportTemplates('owner', draft, changed, [term])).toThrow('時間割が更新');
});
it('rejects a changed owner and a date outside every current term', () => {
  expect(() => requireCurrentTimetableImportTemplates('owner', { ...draft, userId: 'other' }, templates, [term])).toThrow();
  const single = templates.slice(0);
  const outside = { ...draft, date: '2026-11-02', sourceId: templates[0].id, endTime: templates[0].endTime };
  expect(() => requireCurrentTimetableImportTemplates('owner', outside, [single[0]], [term])).toThrow();
});
