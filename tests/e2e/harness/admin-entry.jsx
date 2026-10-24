import React from 'react';
import ReactDOM from 'react-dom/client';
import { ApplicationRouteRoot } from '../../../src/components/ApplicationRouteRoot';
import { adminEntryAuth } from './admin-entry-access.fixture';
import '../../../src/styles.css';
import '../../../src/styles/interaction-continuity.css';
import '../../../src/styles/appSettingsMemory.css';

const user = { id: 'admin-entry-owner', email: 'admin-entry@example.test', username: 'Entry fixture', avatar: '', createdAt: new Date().toISOString() };
localStorage.setItem('studyplanner.users', JSON.stringify([user]));
localStorage.setItem('studyplanner.session', user.id);
for (const key of ['plans', 'actuals', 'dayNotes', 'monthEvents', 'todos.v1', 'studyMaterials.v1', 'studySubjects.v1',
  'scheduleTemplates.v1', 'timetableTerms.v1', 'timetablePeriods.v1']) localStorage.setItem(`studyplanner.${key}`, '[]');
window.history.replaceState({}, '', '/');
ReactDOM.createRoot(document.getElementById('root')).render(<ApplicationRouteRoot authSession={adminEntryAuth} />);
