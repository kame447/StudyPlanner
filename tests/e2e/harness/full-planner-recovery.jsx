import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../../src/App';
import '../../../src/styles.css';
import '../../../src/styles/interaction-continuity.css';
import '../../../src/styles/appSettingsMemory.css';

const now = '2026-08-19T01:00:00.000Z';
const user = { id: 'planner-recovery-owner', email: 'planner-recovery@example.test', username: 'planner-recovery', avatar: '', createdAt: now };
const subject = { id: 'math', userId: user.id, name: '数学', color: '#2f6fc2', createdAt: now, updatedAt: now };
const material = { id: 'material-before-refresh', userId: user.id, name: '更新前の教材', subjectId: subject.id,
  subjectName: subject.name, color: subject.color, status: 'active', paceEnabled: true,
  progressUnit: 'problem', currentUnit: 10, totalUnits: 100, createdAt: now, updatedAt: now };
// Fresh cases retain the original clean seed. One explicit test-only request
// lets a real reload read its preceding durable save instead of reseeding it.
const preserveNextReload = sessionStorage.getItem('studyplanner.e2e.preserve-next-reload') === 'true';
sessionStorage.removeItem('studyplanner.e2e.preserve-next-reload');
if (!preserveNextReload) {
  localStorage.clear();
  localStorage.setItem('studyplanner.users', JSON.stringify([user]));
  localStorage.setItem('studyplanner.session', user.id);
  for (const key of ['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos.v1', 'scheduleTemplates.v1', 'timetableTerms.v1', 'timetablePeriods.v1']) {
    localStorage.setItem(`studyplanner.${key}`, '[]');
  }
  localStorage.setItem('studyplanner.studySubjects.v1', JSON.stringify([subject]));
  localStorage.setItem('studyplanner.studyMaterials.v1', JSON.stringify([material]));
  localStorage.setItem('study-planner-theme-mode', new URLSearchParams(location.search).get('theme') ?? 'light');
  localStorage.setItem('study-planner-theme-palette', 'ocean');
}
window.__realWeeklyEvents = [];
// Observe durable writes even from another production repository consumer.
// Chat checkpoints are not Plan writes and intentionally remain out of scope.
const observedKeys = new Set(['studyplanner.scheduleTemplates.v1', 'studyplanner.timetableTerms.v1', 'studyplanner.timetablePeriods.v1', 'studyplanner.dayNotes', 'studyplanner.actuals', 'studyplanner.studyMaterials.v1',
  'studyplanner.plans', 'studyplanner.scheduleEvents.v1', 'studyplanner.todos.v1']);
window.__plannerRecoveryStorageWrites = [];
const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  const result = originalSetItem.call(this, key, value);
  if (this === localStorage && observedKeys.has(key)) window.__plannerRecoveryStorageWrites.push({ key, value });
  return result;
};
// App owns real planner and weekly hooks throughout navigation. Startup/provider
// onboarding is outside this regression, as in the existing local full-App specs.
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
