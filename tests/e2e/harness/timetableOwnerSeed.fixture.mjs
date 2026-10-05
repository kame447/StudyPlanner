// Synthetic data only. The active owner deliberately has no terms or periods,
// while six classes reference the legacy global ID occupied by a second owner.
export const LEGACY_TERM_ID = '2026-full-year';
const now = '2026-08-18T01:00:00.000Z';
export const TIMETABLE_OWNER = {
  id: 'timetable-owner-current', email: 'timetable-owner-current@example.test',
  username: 'timetable-owner-current', avatar: '', createdAt: now,
};
export const FOREIGN_OWNER = {
  id: 'timetable-owner-foreign', email: 'timetable-owner-foreign@example.test',
  username: 'timetable-owner-foreign', avatar: '', createdAt: now,
};
export const FOREIGN_TERMS = [
  { id: LEGACY_TERM_ID, userId: FOREIGN_OWNER.id, year: 2026, kind: 'fullYear',
    label: '別ユーザーの通年', isActive: true, createdAt: now, updatedAt: now },
  { id: 'foreign-custom-term', userId: FOREIGN_OWNER.id, year: 2026, kind: 'custom',
    label: '別ユーザーの独自期間', startDate: '2026-08-01', endDate: '2026-08-31',
    isActive: false, createdAt: now, updatedAt: now },
];
export const OWNER_TEMPLATES = [
  ['mon', 1, '数学I'], ['tue', 1, '英語I'], ['wed', 1, '物理I'],
  ['thu', 1, '化学I'], ['fri', 1, '情報I'], ['mon', 2, '国語I'],
].map(([weekday, periodNumber, title], index) => ({
  id: `owner-class-${index + 1}`, userId: TIMETABLE_OWNER.id, title, subject: title,
  type: 'school-event', weekday, periodNumber, termId: LEGACY_TERM_ID,
  startTime: periodNumber === 1 ? '08:40' : '10:20',
  endTime: periodNumber === 1 ? '10:10' : '11:50',
  classroom: `教室${index + 1}`, memo: `保持するメモ${index + 1}`, active: true,
  createdAt: now, updatedAt: now,
}));
export const FOREIGN_TEMPLATES = FOREIGN_TERMS.map((term, index) => ({
  ...OWNER_TEMPLATES[0], id: `foreign-class-${index + 1}`, userId: FOREIGN_OWNER.id,
  title: `別ユーザーの授業${index + 1}`, termId: term.id,
}));
export const FOREIGN_PERIODS = FOREIGN_TERMS.map((term, index) => ({
  id: `foreign-period-${index + 1}`, userId: FOREIGN_OWNER.id, termId: term.id,
  periodNumber: 1, label: '1', startTime: '09:00', endTime: '10:00',
  createdAt: now, updatedAt: now,
}));
export const TIMETABLE_STORAGE_KEYS = [
  'studyplanner.timetableTerms.v1', 'studyplanner.scheduleTemplates.v1',
  'studyplanner.timetablePeriods.v1',
];
export const PRESERVE_TIMETABLE_RELOAD = 'studyplanner.e2e.timetable-owner.preserve-next-reload';

export function seedTimetableOwnerStorage(storage) {
  storage.clear();
  storage.setItem('studyplanner.users', JSON.stringify([TIMETABLE_OWNER, FOREIGN_OWNER]));
  storage.setItem('studyplanner.session', TIMETABLE_OWNER.id);
  for (const key of ['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos.v1',
    'studySubjects.v1', 'studyMaterials.v1']) {
    storage.setItem(`studyplanner.${key}`, '[]');
  }
  storage.setItem(TIMETABLE_STORAGE_KEYS[0], JSON.stringify(FOREIGN_TERMS));
  storage.setItem(TIMETABLE_STORAGE_KEYS[1], JSON.stringify([...FOREIGN_TEMPLATES, ...OWNER_TEMPLATES]));
  storage.setItem(TIMETABLE_STORAGE_KEYS[2], JSON.stringify(FOREIGN_PERIODS));
  storage.setItem('study-planner-theme-mode', 'dark');
  storage.setItem('study-planner-theme-palette', 'ocean');
}
